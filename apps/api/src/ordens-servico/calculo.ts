import type {
  StatusDesconto,
  StatusItemCliente,
  TipoDesconto,
} from '../generated/prisma/client.js';

/** Dinheiro sempre em centavos (Int). */

export interface ItemParaCalculo {
  id?: string;
  quantidade: number;
  precoUnitarioCentavos: number;
  descontoTipo: TipoDesconto | null;
  descontoValor: number | null;
  descontoStatus: StatusDesconto | null;
  statusCliente: StatusItemCliente;
}

export interface DescontoParaCalculo {
  descontoTipo: TipoDesconto | null;
  descontoValor: number | null;
  descontoStatus: StatusDesconto | null;
}

/** Valor do desconto em centavos sobre uma base (nunca maior que a base). */
export function valorDoDesconto(
  base: number,
  tipo: TipoDesconto | null,
  valor: number | null,
): number {
  if (!tipo || !valor || base <= 0) return 0;
  const bruto = tipo === 'PERCENTUAL' ? Math.round((base * valor) / 100) : valor;
  return Math.min(Math.max(bruto, 0), base);
}

/** Só descontos APLICADOS entram na conta (pendentes e recusados não). */
const aplicado = (d: DescontoParaCalculo) =>
  d.descontoStatus === 'APLICADO' ? valorDoDesconto : () => 0;

export interface ValoresItem {
  brutoCentavos: number;
  descontoCentavos: number;
  totalCentavos: number;
}

export function valoresDoItem(item: ItemParaCalculo): ValoresItem {
  const bruto = item.quantidade * item.precoUnitarioCentavos;
  const desconto = aplicado(item)(bruto, item.descontoTipo, item.descontoValor);
  return { brutoCentavos: bruto, descontoCentavos: desconto, totalCentavos: bruto - desconto };
}

export interface Totais {
  /** Soma dos itens sem desconto (o "valor original" riscado). */
  brutoCentavos: number;
  descontoItensCentavos: number;
  subtotalCentavos: number;
  descontoOsCentavos: number;
  totalCentavos: number;
}

function somar(itens: ItemParaCalculo[], os: DescontoParaCalculo): Totais {
  const valores = itens.map(valoresDoItem);
  const bruto = valores.reduce((s, v) => s + v.brutoCentavos, 0);
  const descontoItens = valores.reduce((s, v) => s + v.descontoCentavos, 0);
  const subtotal = bruto - descontoItens;
  const descontoOs = aplicado(os)(subtotal, os.descontoTipo, os.descontoValor);
  return {
    brutoCentavos: bruto,
    descontoItensCentavos: descontoItens,
    subtotalCentavos: subtotal,
    descontoOsCentavos: descontoOs,
    totalCentavos: subtotal - descontoOs,
  };
}

/**
 * Totais da OS (seção 7.3: total = soma dos itens aprovados − descontos).
 * - `aprovado`: só itens APROVADOS — é o que o cliente paga.
 * - `orcado`: itens não recusados (pendentes + aprovados) — o que está sendo proposto.
 */
export function calcularTotais(itens: ItemParaCalculo[], os: DescontoParaCalculo) {
  return {
    orcado: somar(
      itens.filter((i) => i.statusCliente !== 'RECUSADO'),
      os,
    ),
    aprovado: somar(
      itens.filter((i) => i.statusCliente === 'APROVADO'),
      os,
    ),
  };
}
