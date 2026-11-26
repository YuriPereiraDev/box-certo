import { Injectable } from '@nestjs/common';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { ArquivosService } from '../arquivos/arquivos.service.js';
import { pdfmake, reais } from '../common/pdf/pdfmake.js';
import { FUSO_PADRAO } from '../common/utils/datas.js';
import { BancoService } from '../prisma/banco.service.js';
import type { OsCompleta } from './apresentacao.js';
import { calcularTotais, valoresDoItem } from './calculo.js';

export { reais };

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_PADRAO,
  dateStyle: 'short',
  timeStyle: 'short',
});

/** 11222333000181 → 11.222.333/0001-81; 52998224725 → 529.982.247-25. */
export function formatarDocumento(doc: string): string {
  if (doc.length === 14)
    return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return doc;
}

/** 11988887777 → (11) 98888-7777. */
export function formatarTelefone(tel: string): string {
  if (tel.length === 11) return tel.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (tel.length === 10) return tel.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return tel;
}

const NOME_STATUS_ITEM = { PENDENTE: 'Pendente', APROVADO: 'Aprovado', RECUSADO: 'Recusado' };
const NOME_STATUS_OS: Record<string, string> = {
  ABERTA: 'Aberta',
  EM_DIAGNOSTICO: 'Em diagnóstico',
  ORCAMENTO_ENVIADO: 'Orçamento enviado',
  APROVADA: 'Aprovada',
  EM_EXECUCAO: 'Em execução',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

/** PDF do orçamento (com logo e dados da oficina). Nunca inclui custo de peças. */
@Injectable()
export class PdfService {
  constructor(
    private readonly banco: BancoService,
    private readonly arquivos: ArquivosService,
  ) {}

  async orcamento(os: OsCompleta): Promise<Buffer> {
    const oficina = await this.banco.sistema.oficina.findUniqueOrThrow({
      where: { id: os.oficinaId },
    });
    let logo: string | null = null;
    if (oficina.logoArquivoId) {
      const arq = await this.arquivos.conteudo(oficina.logoArquivoId).catch(() => null);
      if (arq && (arq.mime === 'image/png' || arq.mime === 'image/jpeg')) {
        logo = `data:${arq.mime};base64,${arq.buffer.toString('base64')}`;
      }
    }

    const endereco = [
      [oficina.rua, oficina.numero].filter(Boolean).join(', '),
      oficina.bairro,
      [oficina.cidade, oficina.uf].filter(Boolean).join('/'),
    ]
      .filter(Boolean)
      .join(' — ');
    const totais = calcularTotais(os.itens, os);
    const mostrarStatus = os.enviadoEm !== null;

    const cabecalho: Content = {
      columns: [
        ...(logo ? [{ image: logo, fit: [90, 60] as [number, number], width: 100 }] : []),
        {
          stack: [
            { text: oficina.nome, style: 'titulo' },
            oficina.documento ? `CPF/CNPJ: ${formatarDocumento(oficina.documento)}` : '',
            [oficina.telefone && formatarTelefone(oficina.telefone), oficina.email]
              .filter(Boolean)
              .join(' · '),
            endereco,
          ],
        },
        {
          width: 150,
          alignment: 'right',
          stack: [
            { text: `Orçamento / OS nº ${os.numero}`, style: 'subtitulo' },
            `Emitido em ${dataHora.format(new Date())}`,
            `Situação: ${NOME_STATUS_OS[os.status] ?? os.status}`,
          ],
        },
      ],
      columnGap: 12,
    };

    const linhas = os.itens.map((i) => {
      const v = valoresDoItem(i);
      return [
        {
          text: i.descricao + (i.origemPeca === 'CLIENTE_COMPRA' ? '\n(compra pelo cliente)' : ''),
        },
        i.tipo === 'PECA' ? 'Peça' : 'Mão de obra',
        { text: String(i.quantidade), alignment: 'right' as const },
        { text: reais(i.precoUnitarioCentavos), alignment: 'right' as const },
        {
          text: v.descontoCentavos ? `- ${reais(v.descontoCentavos)}` : '',
          alignment: 'right' as const,
        },
        { text: reais(v.totalCentavos), alignment: 'right' as const },
        ...(mostrarStatus ? [NOME_STATUS_ITEM[i.statusCliente]] : []),
      ];
    });

    const linhaTotal = (rotulo: string, valor: string, negrito = false) => ({
      columns: [
        { text: rotulo, alignment: 'right' as const, bold: negrito },
        { text: valor, width: 100, alignment: 'right' as const, bold: negrito },
      ],
    });
    const t = totais.orcado;
    const blocoTotais: Content[] = [
      linhaTotal('Valor dos itens', reais(t.brutoCentavos)),
      ...(t.descontoItensCentavos
        ? [linhaTotal('Descontos nos itens', `- ${reais(t.descontoItensCentavos)}`)]
        : []),
      ...(t.descontoOsCentavos
        ? [linhaTotal('Desconto no total', `- ${reais(t.descontoOsCentavos)}`)]
        : []),
      linhaTotal('Total do orçamento', reais(t.totalCentavos), true),
      ...(mostrarStatus
        ? [linhaTotal('Total aprovado pelo cliente', reais(totais.aprovado.totalCentavos), true)]
        : []),
    ];

    const doc: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [36, 36, 36, 48],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      styles: {
        titulo: { fontSize: 15, bold: true },
        subtitulo: { fontSize: 11, bold: true },
        secao: { fontSize: 10, bold: true, margin: [0, 12, 0, 4] },
        tabelaCabecalho: { bold: true, fillColor: '#eeeeee' },
      },
      footer: (pagina, total) => ({
        text: `Box Certo · página ${pagina} de ${total}`,
        alignment: 'center',
        fontSize: 7,
        color: '#888888',
      }),
      content: [
        cabecalho,
        { text: 'Cliente e veículo', style: 'secao' },
        {
          columns: [
            {
              stack: [
                os.cliente.nome,
                os.cliente.telefone ? formatarTelefone(os.cliente.telefone) : '',
              ],
            },
            {
              stack: [
                `Placa ${os.veiculo.placa}`,
                [os.veiculo.marca, os.veiculo.modelo, os.veiculo.ano].filter(Boolean).join(' '),
                os.kmEntrada !== null
                  ? `Km de entrada: ${os.kmEntrada.toLocaleString('pt-BR')}`
                  : '',
              ],
            },
            {
              stack: [
                `Mecânico: ${os.mecanico.nome}`,
                `Aberta em ${dataHora.format(os.createdAt)}`,
              ],
            },
          ],
        },
        ...(os.diagnostico
          ? [{ text: 'Diagnóstico', style: 'secao' }, { text: os.diagnostico }]
          : []),
        { text: 'Itens', style: 'secao' },
        {
          table: {
            headerRows: 1,
            widths: ['*', 52, 24, 58, 52, 58, ...(mostrarStatus ? [46] : [])],
            body: [
              [
                'Descrição',
                'Tipo',
                'Qtd.',
                'Unitário',
                'Desconto',
                'Total',
                ...(mostrarStatus ? ['Cliente'] : []),
              ].map((text) => ({ text, style: 'tabelaCabecalho' })),
              ...linhas,
            ],
          },
          layout: 'lightHorizontalLines',
        },
        { stack: blocoTotais, margin: [0, 10, 0, 0] },
        ...(os.observacoes
          ? [{ text: 'Observações', style: 'secao' }, { text: os.observacoes }]
          : []),
      ],
    };

    return pdfmake.createPdf(doc).getBuffer();
  }
}
