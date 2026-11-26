import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { pdfmake, reais } from '../common/pdf/pdfmake.js';
import type { Dashboard } from './dashboard.service.js';

const formatoData = (d: string) => d.split('-').reverse().join('/');
const nomeMes = (m: string) => {
  const [ano, mes] = m.split('-');
  return `${mes}/${ano}`;
};

interface Linhas {
  titulo: string;
  cabecalho: string[];
  linhas: (string | number)[][];
  /** Colunas em centavos (viram R$). */
  dinheiro: number[];
}

/** Monta as tabelas uma vez; PDF e Excel usam as mesmas linhas. */
function tabelas(d: Dashboard): { resumo: [string, string | number, boolean][]; outras: Linhas[] } {
  const c = d.cards;
  const resumo: [string, string | number, boolean][] = [
    ['Faturamento (OS pagas)', c.faturamentoCentavos, true],
    ['OS pagas', c.quantidadeOs, false],
    ['Ticket médio', c.ticketMedioCentavos, true],
    ['Total de descontos', c.descontosCentavos, true],
    ['A receber (OS concluídas não pagas)', c.aReceberCentavos, true],
    ['Itens aprovados pelos clientes', c.orcamentos.aprovados.quantidade, false],
    ['Valor aprovado', c.orcamentos.aprovados.valorCentavos, true],
    ['Itens recusados', c.orcamentos.recusados.quantidade, false],
    ['Valor recusado', c.orcamentos.recusados.valorCentavos, true],
    ['Orçamentos aguardando resposta', c.orcamentos.aguardandoResposta, false],
    ['Agendamentos hoje', c.agendamentosHoje.total, false],
  ];
  if (d.financeiro) {
    const f = d.financeiro;
    resumo.push(
      ['Receitas', f.receitasCentavos, true],
      [`Despesas${f.incluiSalarios ? '' : ' (sem salários)'}`, f.despesasCentavos, true],
      ['Lucro', f.lucroCentavos, true],
      ['Custo das peças vendidas', f.custoPecasVendidasCentavos, true],
      ['Contas a vencer em 7 dias', f.contasAVencer7DiasCentavos, true],
      ['Contas vencidas', f.contasVencidasCentavos, true],
    );
  }
  const outras: Linhas[] = [
    {
      titulo: 'Faturamento por mês',
      cabecalho: ['Mês', 'OS pagas', 'Faturamento'],
      linhas: d.graficos.faturamentoPorMes.map((m) => [
        nomeMes(m.mes),
        m.quantidadeOs,
        m.faturamentoCentavos,
      ]),
      dinheiro: [2],
    },
    {
      titulo: 'Por mecânico',
      cabecalho: ['Mecânico', 'OS pagas', 'OS concluídas', 'Faturamento', 'Ticket médio'],
      linhas: d.graficos.porMecanico.map((m) => [
        m.mecanico.nome,
        m.osPagas,
        m.osConcluidas,
        m.faturamentoCentavos,
        m.ticketMedioCentavos,
      ]),
      dinheiro: [3, 4],
    },
    ...(['servicos', 'pecas'] as const).map((tipo) => ({
      titulo: tipo === 'servicos' ? 'Serviços mais feitos' : 'Peças mais usadas',
      cabecalho: ['Descrição', 'Em OS', 'Quantidade', 'Valor'],
      linhas: d.graficos.maisFeitos[tipo].map((x) => [
        x.descricao,
        x.quantidadeOs,
        x.quantidade,
        x.valorCentavos,
      ]),
      dinheiro: [3],
    })),
  ];
  if (d.financeiro) {
    outras.push({
      titulo: 'Despesas por categoria',
      cabecalho: ['Categoria', 'Total'],
      linhas: d.financeiro.despesasPorCategoria.map((x) => [x.categoria, x.totalCentavos]),
      dinheiro: [1],
    });
  }
  return { resumo, outras };
}

/** Exportação do dashboard em PDF e Excel (seção 10). Respeita as mesmas permissões. */
@Injectable()
export class ExportacaoDashboardService {
  async pdf(d: Dashboard, oficina: string): Promise<Buffer> {
    const { resumo, outras } = tabelas(d);
    const tabela = (t: Linhas): Content[] => [
      { text: t.titulo, style: 'secao' },
      t.linhas.length
        ? {
            table: {
              headerRows: 1,
              widths: ['*', ...t.cabecalho.slice(1).map(() => 75)],
              body: [
                t.cabecalho.map((text) => ({ text, bold: true, fillColor: '#eeeeee' })),
                ...t.linhas.map((l) =>
                  l.map((v, i) => ({
                    text: t.dinheiro.includes(i) ? reais(Number(v)) : String(v),
                    alignment: i === 0 ? ('left' as const) : ('right' as const),
                  })),
                ),
              ],
            },
            layout: 'lightHorizontalLines',
          }
        : { text: 'Sem dados no período.', italics: true, color: '#666666' },
    ];
    const doc: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [36, 36, 36, 40],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      styles: {
        titulo: { fontSize: 15, bold: true },
        secao: { fontSize: 11, bold: true, margin: [0, 12, 0, 4] },
      },
      footer: (pagina, total) => ({
        text: `Box Certo · página ${pagina} de ${total}`,
        alignment: 'center',
        fontSize: 7,
        color: '#888888',
      }),
      content: [
        { text: `Dashboard — ${oficina}`, style: 'titulo' },
        `Período: ${formatoData(d.periodo.de)} a ${formatoData(d.periodo.ate)}${d.mecanicoId ? ' · filtrado por mecânico' : ''}`,
        { text: 'Resumo', style: 'secao' },
        {
          table: {
            widths: ['*', 110],
            body: resumo.map(([rotulo, valor, dinheiro]) => [
              rotulo,
              { text: dinheiro ? reais(Number(valor)) : String(valor), alignment: 'right' },
            ]),
          },
          layout: 'lightHorizontalLines',
        },
        ...outras.flatMap(tabela),
      ],
    };
    return pdfmake.createPdf(doc).getBuffer();
  }

  async xlsx(d: Dashboard, oficina: string): Promise<Buffer> {
    const { resumo, outras } = tabelas(d);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Box Certo';
    const formatoReais = '"R$" #,##0.00';

    const r = wb.addWorksheet('Resumo');
    r.addRow([`Dashboard — ${oficina}`]).font = { bold: true, size: 14 };
    r.addRow([`Período: ${formatoData(d.periodo.de)} a ${formatoData(d.periodo.ate)}`]);
    r.addRow([]);
    for (const [rotulo, valor, dinheiro] of resumo) {
      const linha = r.addRow([rotulo, dinheiro ? Number(valor) / 100 : valor]);
      if (dinheiro) linha.getCell(2).numFmt = formatoReais;
    }
    r.getColumn(1).width = 40;
    r.getColumn(2).width = 18;

    for (const t of outras) {
      const ws = wb.addWorksheet(t.titulo.slice(0, 31));
      ws.addRow(t.cabecalho).font = { bold: true };
      for (const l of t.linhas) {
        const linha = ws.addRow(l.map((v, i) => (t.dinheiro.includes(i) ? Number(v) / 100 : v)));
        for (const i of t.dinheiro) linha.getCell(i + 1).numFmt = formatoReais;
      }
      ws.columns.forEach((col, i) => (col.width = i === 0 ? 40 : 16));
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
