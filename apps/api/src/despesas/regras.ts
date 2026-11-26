import type { AtorUsuario } from '../common/contexto/contexto.js';
import { localParaUtc, partesLocais } from '../common/utils/datas.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * Salários (categorias com `ehSalario`): MASTER, ou FINANCEIRO + VER_SALARIOS (seção 4.2).
 * Sem isso a pessoa não vê nada de salário: nem nas listas, nem nos totais (decisão da fase 6).
 */
export function podeVerSalarios(ator: AtorUsuario): boolean {
  return (
    ator.role === 'MASTER' ||
    (ator.permissoes.includes('FINANCEIRO') && ator.permissoes.includes('VER_SALARIOS'))
  );
}

/** Filtro que esconde despesas de salário de quem não pode vê-las. */
export function filtroSalarios(ator: AtorUsuario): Prisma.DespesaWhereInput {
  return podeVerSalarios(ator) ? {} : { categoria: { ehSalario: false } };
}

/** "2026-12" do instante no fuso de São Paulo. */
export function competenciaDe(data: Date): string {
  const p = partesLocais(data);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** Vencimento no mês da competência; meses curtos usam o último dia (31 → 28/29/30). */
export function vencimentoNaCompetencia(competencia: string, diaVencimento: number): Date {
  const [ano, mes] = competencia.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dia = Math.min(diaVencimento, ultimoDia);
  // Meio-dia local: o dia não muda ao exibir em qualquer fuso do Brasil.
  return localParaUtc(`${competencia}-${String(dia).padStart(2, '0')}`, 12 * 60);
}

/**
 * A recorrente gera a despesa do mês se o vencimento desse mês não é anterior ao dia em
 * que ela foi cadastrada (cadastrada no meio do mês com vencimento já passado: só no próximo).
 */
export function deveGerarNaCompetencia(
  criadaEm: Date,
  competencia: string,
  diaVencimento: number,
): boolean {
  const vencimento = vencimentoNaCompetencia(competencia, diaVencimento);
  const p = partesLocais(criadaEm);
  const diaDaCriacao = localParaUtc(
    `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
    0,
  );
  return vencimento >= diaDaCriacao;
}
