import type { AtorUsuario } from '../common/contexto/contexto.js';
import type { Prisma, StatusOS } from '../generated/prisma/client.js';
import { calcularTotais, valoresDoItem } from './calculo.js';

export const INCLUDE_OS = {
  itens: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    include: {
      estoqueItem: {
        select: { id: true, nome: true, codigo: true, quantidade: true, quantidadeReservada: true },
      },
    },
  },
  cliente: { select: { id: true, nome: true, telefone: true, email: true, cpf: true } },
  veiculo: { select: { id: true, placa: true, marca: true, modelo: true, ano: true, cor: true } },
  mecanico: { select: { id: true, nome: true } },
  oficina: { select: { id: true, nome: true, telefone: true } },
} as const satisfies Prisma.OrdemServicoInclude;

export type OsCompleta = Prisma.OrdemServicoGetPayload<{ include: typeof INCLUDE_OS }>;
type ItemOs = OsCompleta['itens'][number];

/** Custo de compra das peças: só MASTER ou permissão FINANCEIRO (seção 4.2). */
export function podeVerCusto(ator: AtorUsuario): boolean {
  return ator.role === 'MASTER' || ator.permissoes.includes('FINANCEIRO');
}

export function apresentarParaOficina(os: OsCompleta, ator: AtorUsuario) {
  const verCusto = podeVerCusto(ator);
  return {
    ...os,
    itens: os.itens.map((i) => {
      const { custoUnitarioCentavos, deletedAt: _d, oficinaId: _o, ...resto } = i;
      return {
        ...resto,
        ...(verCusto ? { custoUnitarioCentavos } : {}),
        ...valoresDoItem(i),
      };
    }),
    totais: calcularTotais(os.itens, os),
  };
}

/** Status em que o cliente já vê o orçamento. */
const STATUS_COM_ORCAMENTO_VISIVEL: StatusOS[] = [
  'ORCAMENTO_ENVIADO',
  'APROVADA',
  'EM_EXECUCAO',
  'CONCLUIDA',
];

export function orcamentoVisivelAoCliente(os: { status: StatusOS; enviadoEm: Date | null }) {
  return (
    STATUS_COM_ORCAMENTO_VISIVEL.includes(os.status) ||
    (os.status === 'CANCELADA' && !!os.enviadoEm)
  );
}

function itemParaCliente(i: ItemOs) {
  const valores = valoresDoItem(i);
  const descontoAplicado = i.descontoStatus === 'APLICADO';
  return {
    id: i.id,
    descricao: i.descricao,
    tipo: i.tipo,
    origemPeca: i.origemPeca,
    quantidade: i.quantidade,
    precoUnitarioCentavos: i.precoUnitarioCentavos,
    // Cliente vê o valor original riscado, o desconto e o total (seção 7.4).
    ...valores,
    desconto: descontoAplicado ? { tipo: i.descontoTipo, valor: i.descontoValor } : null,
    linkAfiliado: i.tipo === 'PECA' ? i.linkAfiliado : null,
    comprarPeca: i.tipo === 'PECA' && !!i.linkAfiliado,
    statusCliente: i.statusCliente,
    // Peça do estoque que acabou: o cliente vê que a oficina vai ajustar.
    aguardandoAjusteDaOficina:
      i.statusCliente === 'PENDENTE' &&
      !!i.estoqueItem &&
      i.estoqueItem.quantidade - i.estoqueItem.quantidadeReservada < i.quantidade,
    respondidoEm: i.respondidoEm,
    substituiItemId: i.substituiItemId,
  };
}

/** O que o cliente vê: sem custo, sem observações internas, sem descontos pendentes. */
export function apresentarParaCliente(os: OsCompleta) {
  const visivel = orcamentoVisivelAoCliente(os);
  const totais = calcularTotais(os.itens, os);
  return {
    id: os.id,
    numero: os.numero,
    status: os.status,
    oficina: os.oficina,
    veiculo: os.veiculo,
    mecanico: { nome: os.mecanico.nome },
    kmEntrada: os.kmEntrada,
    diagnostico: visivel ? os.diagnostico : null,
    enviadoEm: os.enviadoEm,
    aprovadoEm: os.aprovadoEm,
    concluidoEm: os.concluidoEm,
    canceladoEm: os.canceladoEm,
    motivoCancelamento: os.motivoCancelamento,
    statusPagamento: os.statusPagamento,
    createdAt: os.createdAt,
    orcamentoDisponivel: visivel,
    itens: visivel ? os.itens.map(itemParaCliente) : [],
    descontoOs:
      visivel && os.descontoStatus === 'APLICADO'
        ? { tipo: os.descontoTipo, valor: os.descontoValor }
        : null,
    totais: visivel ? totais : null,
  };
}
