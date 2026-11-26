import { partesLocais } from '../common/utils/datas.js';
import type { ItemParaCalculo } from '../ordens-servico/calculo.js';
import { calcularTotais, valoresDoItem } from '../ordens-servico/calculo.js';
import type { StatusDesconto, TipoDesconto, TipoItem } from '../generated/prisma/client.js';

/** OS com o necessário para os indicadores (dinheiro sempre em centavos). */
export interface OsParaIndicador {
  id: string;
  mecanicoId: string;
  pagoEm: Date | null;
  concluidoEm: Date | null;
  descontoTipo: TipoDesconto | null;
  descontoValor: number | null;
  descontoStatus: StatusDesconto | null;
  itens: (ItemParaCalculo & {
    descricao: string;
    tipo: TipoItem;
    tabelaPrecoId: string | null;
    estoqueItemId: string | null;
    custoUnitarioCentavos: number | null;
  })[];
}

/** Valor faturado da OS = total aprovado (itens aprovados − descontos aplicados). */
export function valorDaOs(os: OsParaIndicador) {
  const t = calcularTotais(os.itens, os).aprovado;
  return {
    totalCentavos: t.totalCentavos,
    descontosCentavos: t.descontoItensCentavos + t.descontoOsCentavos,
  };
}

export function cardsDeFaturamento(ordens: OsParaIndicador[]) {
  const valores = ordens.map(valorDaOs);
  const faturamento = valores.reduce((s, v) => s + v.totalCentavos, 0);
  return {
    faturamentoCentavos: faturamento,
    quantidadeOs: ordens.length,
    ticketMedioCentavos: ordens.length ? Math.round(faturamento / ordens.length) : 0,
    descontosCentavos: valores.reduce((s, v) => s + v.descontosCentavos, 0),
  };
}

/** "2026-12" no fuso de São Paulo. */
export function mesLocal(data: Date): string {
  const p = partesLocais(data);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** Os N meses terminando em `ultimo` ("2026-12"), em ordem. */
export function mesesAte(ultimo: string, n: number): string[] {
  const [ano, mes] = ultimo.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** Faturamento por mês de pagamento, com zeros nos meses sem venda. */
export function faturamentoPorMes(ordens: OsParaIndicador[], meses: string[]) {
  const soma = new Map(meses.map((m) => [m, { faturamentoCentavos: 0, quantidadeOs: 0 }]));
  for (const os of ordens) {
    if (!os.pagoEm) continue;
    const linha = soma.get(mesLocal(os.pagoEm));
    if (!linha) continue;
    linha.faturamentoCentavos += valorDaOs(os).totalCentavos;
    linha.quantidadeOs++;
  }
  return meses.map((mes) => ({ mes, ...soma.get(mes)! }));
}

/** Faturamento (OS pagas) e produtividade (OS concluídas) por mecânico. */
export function porMecanico(
  pagas: OsParaIndicador[],
  concluidas: OsParaIndicador[],
  mecanicos: { id: string; nome: string }[],
) {
  return mecanicos
    .map((m) => {
      const minhas = pagas.filter((o) => o.mecanicoId === m.id);
      const c = cardsDeFaturamento(minhas);
      return {
        mecanico: m,
        faturamentoCentavos: c.faturamentoCentavos,
        ticketMedioCentavos: c.ticketMedioCentavos,
        osPagas: minhas.length,
        osConcluidas: concluidas.filter((o) => o.mecanicoId === m.id).length,
      };
    })
    .sort(
      (a, b) => b.faturamentoCentavos - a.faturamentoCentavos || b.osConcluidas - a.osConcluidas,
    );
}

/**
 * Serviços e peças mais feitos (itens aprovados das OS pagas). Agrupa pelo item da tabela,
 * pela peça do estoque ou, se digitado, pela descrição.
 */
export function maisFeitos(ordens: OsParaIndicador[], limite = 10) {
  const grupos = new Map<
    string,
    {
      descricao: string;
      tipo: TipoItem;
      quantidade: number;
      ordens: Set<string>;
      valorCentavos: number;
    }
  >();
  for (const os of ordens) {
    for (const i of os.itens) {
      if (i.statusCliente !== 'APROVADO') continue;
      const chave =
        i.estoqueItemId ?? i.tabelaPrecoId ?? `${i.tipo}:${i.descricao.trim().toLowerCase()}`;
      const g = grupos.get(chave) ?? {
        descricao: i.descricao,
        tipo: i.tipo,
        quantidade: 0,
        ordens: new Set<string>(),
        valorCentavos: 0,
      };
      g.quantidade += i.quantidade;
      g.ordens.add(os.id);
      g.valorCentavos += valoresDoItem(i).totalCentavos;
      grupos.set(chave, g);
    }
  }
  const lista = [...grupos.values()]
    .map(({ ordens: o, ...g }) => ({ ...g, quantidadeOs: o.size }))
    .sort(
      (a, b) =>
        b.quantidadeOs - a.quantidadeOs ||
        b.quantidade - a.quantidade ||
        b.valorCentavos - a.valorCentavos,
    );
  return {
    servicos: lista.filter((g) => g.tipo === 'MAO_DE_OBRA').slice(0, limite),
    pecas: lista.filter((g) => g.tipo === 'PECA').slice(0, limite),
  };
}

/** Custo das peças aprovadas (para quem tem FINANCEIRO). */
export function custoDasPecas(ordens: OsParaIndicador[]): number {
  return ordens.reduce(
    (s, os) =>
      s +
      os.itens
        .filter((i) => i.statusCliente === 'APROVADO' && i.tipo === 'PECA')
        .reduce((t, i) => t + (i.custoUnitarioCentavos ?? 0) * i.quantidade, 0),
    0,
  );
}
