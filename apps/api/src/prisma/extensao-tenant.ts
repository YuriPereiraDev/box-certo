import { Prisma } from '../generated/prisma/client.js';

/**
 * Modelos isolados por oficina. Toda consulta feita pelo cliente "tenant" nesses modelos
 * recebe `oficinaId` do token automaticamente. Ao criar um modelo novo com `oficinaId`,
 * adicione-o aqui.
 */
export const MODELOS_TENANT = new Set<string>([
  'User',
  'ClienteOficina',
  'AuditLog',
  'HorarioFuncionamento',
  'Convite',
  'ItemTabelaPreco',
  'VeiculoOficina',
  'Agendamento',
  'OrdemServico',
  'ItemOrcamento',
  'Arquivo',
  'EstoqueItem',
  'MovimentoEstoque',
  'CategoriaDespesa',
  'Despesa',
  'DespesaRecorrente',
]);

const OPERACOES_COM_WHERE = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

type Args = Record<string, unknown>;

export class ErroSemOficinaNoContexto extends Error {
  constructor(modelo: string) {
    super(`Consulta em ${modelo} sem oficina no contexto (acesso bloqueado)`);
  }
}

/** Injeta o filtro/valor de `oficinaId` nos argumentos de uma operação. Função pura (testável). */
export function aplicarFiltroTenant(
  operacao: string,
  args: Args | undefined,
  oficinaId: string,
): Args {
  const novo: Args = { ...(args ?? {}) };

  if (OPERACOES_COM_WHERE.has(operacao)) {
    novo.where = { ...(novo.where ?? {}), oficinaId };
  }

  if (operacao === 'create') {
    novo.data = { ...(novo.data as Args), oficinaId };
  }
  if (operacao === 'createMany' || operacao === 'createManyAndReturn') {
    const dados = novo.data as Args | Args[];
    novo.data = Array.isArray(dados)
      ? dados.map((d) => ({ ...d, oficinaId }))
      : { ...dados, oficinaId };
  }
  if (operacao === 'upsert') {
    novo.create = { ...(novo.create as Args), oficinaId };
    novo.update = semOficinaId(novo.update as Args);
  }
  if (operacao === 'update' || operacao === 'updateMany' || operacao === 'updateManyAndReturn') {
    // Um registro nunca muda de oficina.
    novo.data = semOficinaId(novo.data as Args);
  }
  return novo;
}

function semOficinaId(dados: Args | undefined): Args {
  const { oficinaId: _ignorado, ...resto } = dados ?? {};
  return resto;
}

/**
 * Extensão do Prisma que isola os dados por oficina. Falha fechado: sem oficina no
 * contexto, qualquer consulta a um modelo da oficina é recusada.
 */
export function extensaoTenant(obterOficinaId: () => string | undefined) {
  return Prisma.defineExtension({
    name: 'tenant',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!MODELOS_TENANT.has(model)) return query(args);
          const oficinaId = obterOficinaId();
          if (!oficinaId) throw new ErroSemOficinaNoContexto(model);
          return query(aplicarFiltroTenant(operation, args, oficinaId));
        },
      },
    },
  });
}
