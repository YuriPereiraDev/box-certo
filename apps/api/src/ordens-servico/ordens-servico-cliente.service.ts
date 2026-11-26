import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ArquivosService } from '../arquivos/arquivos.service.js';
import { ReservasEstoqueService } from '../estoque/reservas-estoque.service.js';
import type { AtorCliente } from '../common/contexto/contexto.js';
import type { StatusOS } from '../generated/prisma/client.js';
import { BancoService } from '../prisma/banco.service.js';
import {
  apresentarParaCliente,
  INCLUDE_OS,
  orcamentoVisivelAoCliente,
  type OsCompleta,
} from './apresentacao.js';
import type { RespostaItemDto } from './ordens-servico.dto.js';
import {
  cancelarAgendamentoDaOs,
  ENTIDADE_FOTO_OS,
  itemPecaDoCliente,
} from './ordens-servico.service.js';

/** O cliente pode cancelar enquanto o serviço não começou. */
const STATUS_CANCELAVEIS_PELO_CLIENTE: StatusOS[] = [
  'ABERTA',
  'EM_DIAGNOSTICO',
  'ORCAMENTO_ENVIADO',
  'APROVADA',
];

/** Ordens de serviço — lado do cliente (só as dele, de qualquer oficina). */
@Injectable()
export class OrdensServicoClienteService {
  constructor(
    private readonly banco: BancoService,
    private readonly arquivos: ArquivosService,
    private readonly reservas: ReservasEstoqueService,
  ) {}

  async carregar(cliente: AtorCliente, id: string): Promise<OsCompleta> {
    const os = await this.banco.sistema.ordemServico.findFirst({
      where: { id, clienteId: cliente.id },
      include: INCLUDE_OS,
    });
    if (!os) throw new NotFoundException('Ordem de serviço não encontrada');
    return os;
  }

  async listar(cliente: AtorCliente) {
    const lista = await this.banco.sistema.ordemServico.findMany({
      where: { clienteId: cliente.id },
      include: INCLUDE_OS,
      orderBy: { createdAt: 'desc' },
    });
    return lista.map((os) => {
      const { itens: _i, ...resumo } = apresentarParaCliente(os);
      return {
        ...resumo,
        aguardandoResposta: os.status === 'ORCAMENTO_ENVIADO',
      };
    });
  }

  async detalhar(cliente: AtorCliente, id: string) {
    const os = await this.carregar(cliente, id);
    return {
      ...apresentarParaCliente(os),
      fotos: orcamentoVisivelAoCliente(os)
        ? await this.arquivos.listar(os.oficinaId, ENTIDADE_FOTO_OS, os.id)
        : [],
    };
  }

  /**
   * Aprova ou recusa itens. Ao recusar uma peça, o cliente pode avisar que vai trazê-la:
   * entra um item "peça trazida pelo cliente" (não cobrado) no lugar.
   * Quando não sobra item pendente: algum aprovado → APROVADA; tudo recusado → EM_DIAGNOSTICO.
   */
  async responder(cliente: AtorCliente, id: string, respostas: RespostaItemDto[]) {
    const ids = respostas.map((r) => r.itemId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Item repetido nas respostas');

    const indisponiveis: { itemId: string; descricao: string }[] = [];
    await this.banco.sistema.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${id}))) t`;
      const os = await tx.ordemServico.findFirst({
        where: { id, clienteId: cliente.id },
        include: INCLUDE_OS,
      });
      if (!os) throw new NotFoundException('Ordem de serviço não encontrada');
      if (os.status !== 'ORCAMENTO_ENVIADO') {
        throw new UnprocessableEntityException({
          codigo: 'STATUS_NAO_PERMITE',
          mensagem: 'Este orçamento não está aguardando sua resposta',
        });
      }

      const agora = new Date();
      for (const r of respostas) {
        const item = os.itens.find((i) => i.id === r.itemId);
        if (!item) throw new NotFoundException('Item não encontrado');
        if (item.statusCliente !== 'PENDENTE') {
          throw new UnprocessableEntityException({
            codigo: 'ITEM_JA_RESPONDIDO',
            mensagem: `O item "${item.descricao}" já foi respondido`,
          });
        }
        if (r.vouTrazerAPeca) {
          const trazivel =
            !r.aprovado && item.tipo === 'PECA' && item.origemPeca !== 'CLIENTE_COMPRA';
          if (!trazivel) {
            throw new BadRequestException(
              'Só dá para trazer a peça ao recusar uma peça da oficina',
            );
          }
        }
        // Peça do estoque: a aprovação reserva a quantidade. Sem saldo, o item fica
        // pendente ("a oficina vai ajustar") e a oficina troca a origem ou dá entrada.
        if (r.aprovado && item.origemPeca === 'ESTOQUE') {
          const reservou = await this.reservas.reservar(tx, item, cliente);
          if (!reservou) {
            indisponiveis.push({ itemId: item.id, descricao: item.descricao });
            continue;
          }
        }
        await tx.itemOrcamento.update({
          where: { id: item.id },
          data: { statusCliente: r.aprovado ? 'APROVADO' : 'RECUSADO', respondidoEm: agora },
        });
        if (r.vouTrazerAPeca)
          await tx.itemOrcamento.create({ data: itemPecaDoCliente(item, 'APROVADO') });
      }

      const itens = await tx.itemOrcamento.findMany({
        where: { ordemServicoId: id, deletedAt: null },
        select: { statusCliente: true },
      });
      if (itens.some((i) => i.statusCliente === 'PENDENTE')) return;
      const algumAprovado = itens.some((i) => i.statusCliente === 'APROVADO');
      await tx.ordemServico.update({
        where: { id },
        data: algumAprovado
          ? { status: 'APROVADA', aprovadoEm: agora }
          : { status: 'EM_DIAGNOSTICO' },
      });
    });
    const detalhe = await this.detalhar(cliente, id);
    if (indisponiveis.length === 0) return detalhe;
    return {
      ...detalhe,
      itensIndisponiveis: indisponiveis,
      aviso:
        'Algumas peças acabaram no estoque e ficaram pendentes. A oficina vai ajustar o orçamento e reenviar.',
    };
  }

  async cancelar(cliente: AtorCliente, id: string, motivo?: string) {
    const os = await this.carregar(cliente, id);
    if (!STATUS_CANCELAVEIS_PELO_CLIENTE.includes(os.status)) {
      throw new UnprocessableEntityException({
        codigo: 'STATUS_NAO_PERMITE',
        mensagem: 'O serviço já começou ou terminou. Fale com a oficina para cancelar.',
      });
    }
    await this.banco.sistema.$transaction(async (tx) => {
      await tx.ordemServico.update({
        where: { id },
        data: {
          status: 'CANCELADA',
          canceladoEm: new Date(),
          canceladoPorTipo: 'CLIENTE',
          canceladoPorId: cliente.id,
          motivoCancelamento: motivo ?? 'Cancelada pelo cliente',
        },
      });
      await this.reservas.liberarDaOs(tx, id, cliente, 'OS cancelada pelo cliente');
      await cancelarAgendamentoDaOs(tx, os.agendamentoId, 'CLIENTE', motivo);
    });
    return this.detalhar(cliente, id);
  }

  /** Histórico do veículo do cliente em todas as oficinas. */
  async historicoVeiculo(cliente: AtorCliente, veiculoId: string) {
    const veiculo = await this.banco.sistema.veiculo.findFirst({
      where: { id: veiculoId, clienteId: cliente.id },
      select: { id: true, placa: true, marca: true, modelo: true, ano: true },
    });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado');
    const ordens = await this.banco.sistema.ordemServico.findMany({
      where: { veiculoId, clienteId: cliente.id },
      include: INCLUDE_OS,
      orderBy: { createdAt: 'desc' },
    });
    return {
      veiculo,
      ordensServico: ordens.map((os) => {
        const a = apresentarParaCliente(os);
        return {
          id: a.id,
          numero: a.numero,
          oficina: a.oficina,
          status: a.status,
          kmEntrada: a.kmEntrada,
          createdAt: a.createdAt,
          concluidoEm: a.concluidoEm,
          servicos: a.itens.filter((i) => i.statusCliente === 'APROVADO').map((i) => i.descricao),
          totalCentavos: a.totais?.aprovado.totalCentavos ?? null,
        };
      }),
    };
  }
}
