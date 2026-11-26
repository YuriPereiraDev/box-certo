import type { AtorPlataforma, AtorUsuario } from '../common/contexto/contexto.js';
import { podeVerSalarios } from '../despesas/regras.js';
import { podeVerCusto } from '../ordens-servico/apresentacao.js';
import { podeVerValores } from '../platform/regras.js';

export const OCULTO = '[RESTRITO]';

/** Entidades financeiras da oficina: só MASTER ou permissão FINANCEIRO veem os dados. */
const ENTIDADES_FINANCEIRAS = new Set(['Despesa', 'DespesaRecorrente', 'CategoriaDespesa']);

interface LogComDados {
  entidade: string;
  antes: unknown;
  depois: unknown;
}

/** Troca por [RESTRITO] as chaves que casam com o teste, em qualquer nível. */
export function ocultarChaves(valor: unknown, deveOcultar: (chave: string) => boolean): unknown {
  if (Array.isArray(valor)) return valor.map((v) => ocultarChaves(v, deveOcultar));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [
        k,
        deveOcultar(k) ? OCULTO : ocultarChaves(v, deveOcultar),
      ]),
    );
  }
  return valor;
}

const ehCusto = (k: string) => /^custo/i.test(k);
const ehDinheiro = (k: string) => /centavos$/i.test(k);

/** O log trata de uma despesa (ou recorrente) de salário? */
function ehDeSalario(log: LogComDados, categoriasSalario: Set<string>): boolean {
  const dados = [log.antes, log.depois].filter(
    (d): d is Record<string, unknown> => !!d && typeof d === 'object',
  );
  return dados.some(
    (d) =>
      d.ehSalario === true ||
      !!d.funcionarioId ||
      !!d.subtipoSalario ||
      (typeof d.categoriaId === 'string' && categoriasSalario.has(d.categoriaId)),
  );
}

/**
 * Logs da oficina respeitando as mesmas regras das telas (seção 4.2):
 * - sem FINANCEIRO: despesas, recorrentes e categorias aparecem sem os dados;
 * - sem VER_SALARIOS: logs de salário aparecem sem os dados;
 * - sem permissão de custo: chaves de custo viram [RESTRITO].
 * A ação, a entidade, o ator e a data continuam visíveis (o log não some).
 */
export function sanitizarLogOficina<T extends LogComDados>(
  log: T,
  ator: AtorUsuario,
  categoriasSalario: Set<string>,
): T & { dadosRestritos?: boolean } {
  const financeiro = ator.role === 'MASTER' || ator.permissoes.includes('FINANCEIRO');
  const restrito =
    (ENTIDADES_FINANCEIRAS.has(log.entidade) && !financeiro) ||
    (!podeVerSalarios(ator) && ehDeSalario(log, categoriasSalario));
  if (restrito) return { ...log, antes: null, depois: null, dadosRestritos: true };
  if (podeVerCusto(ator)) return log;
  return {
    ...log,
    antes: ocultarChaves(log.antes, ehCusto),
    depois: ocultarChaves(log.depois, ehCusto),
  };
}

/** Logs da plataforma: sem FINANCEIRO, todo valor em dinheiro vira [RESTRITO] (critério da fase 8). */
export function sanitizarLogPlataforma<T extends LogComDados>(log: T, admin: AtorPlataforma): T {
  if (podeVerValores(admin)) return log;
  return {
    ...log,
    antes: ocultarChaves(log.antes, ehDinheiro),
    depois: ocultarChaves(log.depois, ehDinheiro),
  };
}
