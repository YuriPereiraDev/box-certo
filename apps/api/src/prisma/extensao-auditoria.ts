import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { AlteracaoAuditada } from '../common/contexto/contexto.js';

/** Modelos que não geram auditoria automática (o próprio log e tokens de sessão). */
const MODELOS_IGNORADOS = new Set(['AuditLog', 'RefreshToken']);

const OPERACOES_ESCRITA = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/** Campos que nunca vão para o log em claro. */
const CAMPOS_PROTEGIDOS = new Set(['senhaHash', 'totpSecret', 'hash', 'tokenCriptografado']);

export function protegerCampos(valor: unknown): unknown {
  if (valor === null || valor === undefined) return null;
  // Normaliza Date, Decimal etc. para JSON puro.
  const json: unknown = JSON.parse(JSON.stringify(valor));
  const limpar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(limpar);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, val]) => [
          k,
          CAMPOS_PROTEGIDOS.has(k) ? '[PROTEGIDO]' : limpar(val),
        ]),
      );
    }
    return v;
  };
  return limpar(json);
}

type Registro = Record<string, unknown> | null | undefined;

function idDoRegistro(registro: Registro): string | null {
  if (!registro) return null;
  if (typeof registro.id === 'string') return registro.id;
  // Chaves compostas (ex.: ClienteOficina)
  const partes = ['clienteId', 'oficinaId']
    .map((k) => registro[k])
    .filter((v) => typeof v === 'string');
  return partes.length ? partes.join(':') : null;
}

type Delegate = {
  findUnique(args: unknown): Promise<Registro>;
  findMany(args: unknown): Promise<Registro[]>;
};

/**
 * Extensão do Prisma que captura `antes` e `depois` de toda escrita.
 * As alterações são entregues a `registrar`, que as junta ao contexto da requisição
 * (o interceptor grava o AuditLog) ou grava direto quando não há requisição (jobs).
 */
export function extensaoAuditoria(
  base: PrismaClient,
  registrar: (alteracao: AlteracaoAuditada) => Promise<void> | void,
) {
  return Prisma.defineExtension({
    name: 'auditoria',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!OPERACOES_ESCRITA.has(operation) || MODELOS_IGNORADOS.has(model)) {
            return query(args);
          }
          const nomeDelegate = model.charAt(0).toLowerCase() + model.slice(1);
          const delegate = (base as unknown as Record<string, Delegate>)[nomeDelegate];
          const where = (args as { where?: unknown }).where;

          let antes: Registro | Registro[] = null;
          if (operation === 'update' || operation === 'upsert' || operation === 'delete') {
            antes = await delegate.findUnique({ where });
          } else if (operation.startsWith('updateMany') || operation === 'deleteMany') {
            antes = await delegate.findMany({ where, take: 100 });
          }

          const resultado: unknown = await query(args);

          const umRegistro =
            operation === 'create' || operation === 'update' || operation === 'upsert';
          // delete: não há "depois"; operações em lote: { count } ou a lista retornada.
          const depois = operation === 'delete' ? null : resultado;
          const referencia = (
            umRegistro ? resultado : Array.isArray(antes) ? null : antes
          ) as Registro;

          await registrar({
            entidade: model,
            operacao: operation,
            entidadeId:
              idDoRegistro(referencia) ?? idDoRegistro(Array.isArray(antes) ? null : antes),
            oficinaId:
              (typeof referencia?.oficinaId === 'string' ? referencia.oficinaId : null) ??
              (!Array.isArray(antes) && typeof antes?.oficinaId === 'string'
                ? antes.oficinaId
                : null),
            antes: protegerCampos(antes),
            depois: protegerCampos(depois),
          });
          return resultado;
        },
      },
    },
  });
}
