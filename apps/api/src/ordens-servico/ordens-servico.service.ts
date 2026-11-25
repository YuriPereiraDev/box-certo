import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ArquivosService } from '../arquivos/arquivos.service.js';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import { localParaUtc, somarDias } from '../common/utils/datas.js';
import { ROLES_QUE_CONTAM } from '../common/utils/plano.service.js';
import type { Prisma, StatusOS } from '../generated/prisma/client.js';
import { BancoService, type ClienteSistema } from '../prisma/banco.service.js';
import {
  apresentarParaOficina,
  INCLUDE_OS,
  podeVerCusto,
  type OsCompleta,
} from './apresentacao.js';
import { calcularTotais, valorDoDesconto, valoresDoItem } from './calculo.js';
import type {
  AbrirOsDto,
  AtualizarItemDto,
  DadosVerificacaoDto,
  DescontoDto,
  FiltroOsDto,
  ItemOrcamentoDto,
} from './ordens-servico.dto.js';
import { decidirDesconto, podeAprovarDesconto } from './regras-desconto.js';

type Tx = Parameters<Parameters<ClienteSistema['$transaction']>[0]>[0];

export const ENTIDADE_FOTO_OS = 'ORDEM_SERVICO';
export const MAX_FOTOS_POR_OS = 30;

/** Status em que o orçamento ainda pode ser montado/alterado. */
const STATUS_EDITAVEIS: StatusOS[] = ['ABERTA', 'EM_DIAGNOSTICO', 'ORCAMENTO_ENVIADO', 'APROVADA'];
const STATUS_ENCERRADOS: StatusOS[] = ['CONCLUIDA', 'CANCELADA'];

const naoPermite = (mensagem: string) =>
  new UnprocessableEntityException({ codigo: 'STATUS_NAO_PERMITE', mensagem });

/** Ordens de serviço — lado da oficina. */
@Injectable()
export class OrdensServicoService {
  constructor(
    private readonly banco: BancoService,
    private readonly arquivos: ArquivosService,
  ) {}

  // ----------------------------------------------------------------- acesso

  /** Mecânico sem GERENTE vê só as próprias OS (seção 4.2). */
  veSoAsProprias(ator: AtorUsuario): boolean {
    return ator.role === 'MECANICO' && !ator.permissoes.includes('GERENTE');
  }

  private visibilidade(ator: AtorUsuario): Prisma.OrdemServicoWhereInput {
    return this.veSoAsProprias(ator) ? { mecanicoId: ator.id } : {};
  }

  /** Quem pode mexer na OS: o mecânico dela, um gerente ou o master. */
  private exigirEdicao(ator: AtorUsuario, os: { mecanicoId: string }) {
    if (podeAprovarDesconto(ator) || os.mecanicoId === ator.id) return;
    throw new ForbiddenException('Só o mecânico da OS, um gerente ou o master podem alterá-la');
  }

  async carregar(ator: AtorUsuario, id: string): Promise<OsCompleta> {
    const os = await this.banco.tenant.ordemServico.findFirst({
      where: { id, ...this.visibilidade(ator) },
      include: INCLUDE_OS,
    });
    if (!os) throw new NotFoundException('Ordem de serviço não encontrada');
    return os;
  }

  async detalhar(ator: AtorUsuario, id: string) {
    const os = await this.carregar(ator, id);
    return {
      ...apresentarParaOficina(os, ator),
      fotos: await this.arquivos.listar(os.oficinaId, ENTIDADE_FOTO_OS, os.id),
    };
  }

  async listar(ator: AtorUsuario, f: FiltroOsDto) {
    const lista = await this.banco.tenant.ordemServico.findMany({
      where: {
        ...this.visibilidade(ator),
        status: f.status,
        clienteId: f.clienteId,
        veiculoId: f.veiculoId,
        ...(f.mecanicoId && !this.veSoAsProprias(ator) ? { mecanicoId: f.mecanicoId } : {}),
        createdAt: {
          gte: f.de ? localParaUtc(f.de, 0) : undefined,
          lt: f.ate ? localParaUtc(somarDias(f.ate, 1), 0) : undefined,
        },
      },
      include: INCLUDE_OS,
      orderBy: { numero: 'desc' },
      take: 200,
    });
    return lista.map((os) => {
      const { itens: _itens, ...resumo } = apresentarParaOficina(os, ator);
      return { ...resumo, quantidadeItens: os.itens.length };
    });
  }

  // ----------------------------------------------------------------- abertura

  private async exigirMecanico(mecanicoId: string) {
    const m = await this.banco.tenant.user.findFirst({
      where: { id: mecanicoId, ativo: true, role: { in: [...ROLES_QUE_CONTAM] } },
      select: { id: true },
    });
    if (!m) throw new BadRequestException('Mecânico inválido ou inativo');
  }

  /** Abre a OS a partir de um agendamento ou direto no balcão. Número sequencial por oficina. */
  async abrir(ator: AtorUsuario, dto: AbrirOsDto) {
    const {
      agendamentoId,
      clienteId: clienteDto,
      veiculoId: veiculoDto,
      mecanicoId: mecDto,
      ...dados
    } = dto;
    let clienteId = clienteDto;
    let veiculoId = veiculoDto;
    let mecanicoId = mecDto ?? null;

    if (agendamentoId) {
      const ag = await this.banco.tenant.agendamento.findFirst({
        where: { id: agendamentoId },
        include: { ordemServico: { select: { id: true } } },
      });
      if (!ag) throw new NotFoundException('Agendamento não encontrado');
      if (this.veSoAsProprias(ator) && ag.mecanicoId && ag.mecanicoId !== ator.id) {
        throw new NotFoundException('Agendamento não encontrado');
      }
      if (ag.ordemServico) {
        throw new ConflictException({
          codigo: 'OS_JA_EXISTE',
          mensagem: 'Este agendamento já tem OS',
          osId: ag.ordemServico.id,
        });
      }
      if (!['AGENDADO', 'CONFIRMADO', 'EM_ATENDIMENTO'].includes(ag.status)) {
        throw naoPermite('O agendamento está encerrado');
      }
      clienteId = ag.clienteId;
      veiculoId = ag.veiculoId;
      mecanicoId ??= ag.mecanicoId;
    } else {
      if (!clienteId || !veiculoId) {
        throw new BadRequestException('Informe o agendamento ou o cliente e o veículo');
      }
      const vinculo = await this.banco.tenant.clienteOficina.findFirst({ where: { clienteId } });
      if (!vinculo) throw new NotFoundException('Cliente não encontrado');
      const veiculo = await this.banco.sistema.veiculo.findFirst({
        where: { id: veiculoId, clienteId, ativo: true },
        select: { id: true },
      });
      if (!veiculo) throw new NotFoundException('Veículo não encontrado');
    }

    if (mecanicoId && mecanicoId !== ator.id && this.veSoAsProprias(ator)) {
      throw new ForbiddenException('Mecânico só abre OS para si mesmo');
    }
    if (!mecanicoId) {
      if (ator.role === 'FINANCEIRO')
        throw new BadRequestException('Informe o mecânico responsável');
      mecanicoId = ator.id;
    }
    await this.exigirMecanico(mecanicoId);

    const oficinaId = ator.oficinaId;
    const id = await this.banco.sistema.$transaction(async (tx) => {
      // Incremento atômico (trava a linha da oficina): número único e sem buracos por corrida.
      const [{ numero }] = await tx.$queryRaw<{ numero: number }[]>`
        UPDATE "Oficina" SET "proximoNumeroOS" = "proximoNumeroOS" + 1
        WHERE id = ${oficinaId} RETURNING "proximoNumeroOS" - 1 AS numero`;
      const os = await tx.ordemServico.create({
        data: {
          ...dados,
          oficinaId,
          numero,
          agendamentoId,
          clienteId: clienteId,
          veiculoId: veiculoId,
          mecanicoId: mecanicoId,
          status: dados.diagnostico ? 'EM_DIAGNOSTICO' : 'ABERTA',
        },
        select: { id: true },
      });
      await tx.veiculoOficina.upsert({
        where: { veiculoId_oficinaId: { veiculoId: veiculoId, oficinaId } },
        update: {},
        create: { veiculoId: veiculoId, oficinaId },
      });
      if (agendamentoId) {
        await tx.agendamento.update({
          where: { id: agendamentoId },
          data: { status: 'EM_ATENDIMENTO', mecanicoId },
        });
      }
      return os.id;
    });
    return this.detalhar(ator, id);
  }

  async atualizarDados(ator: AtorUsuario, id: string, dto: DadosVerificacaoDto) {
    const os = await this.carregar(ator, id);
    this.exigirEdicao(ator, os);
    if (STATUS_ENCERRADOS.includes(os.status)) throw naoPermite('A OS está encerrada');
    await this.banco.tenant.ordemServico.update({
      where: { id },
      data: { ...dto, ...(os.status === 'ABERTA' ? { status: 'EM_DIAGNOSTICO' } : {}) },
    });
    return this.detalhar(ator, id);
  }

  async trocarMecanico(ator: AtorUsuario, id: string, mecanicoId: string) {
    if (!podeAprovarDesconto(ator))
      throw new ForbiddenException('Só master ou gerente trocam o mecânico');
    const os = await this.carregar(ator, id);
    if (STATUS_ENCERRADOS.includes(os.status)) throw naoPermite('A OS está encerrada');
    await this.exigirMecanico(mecanicoId);
    await this.banco.tenant.ordemServico.update({ where: { id }, data: { mecanicoId } });
    return this.detalhar(ator, id);
  }

  // ----------------------------------------------------------------- itens

  /**
   * Regra escolhida: qualquer alteração no orçamento depois do envio zera as respostas do
   * cliente e a OS volta para EM_DIAGNOSTICO até ser reenviada.
   */
  private async aposAlterarItens(tx: Tx, os: { id: string; status: StatusOS }) {
    if (os.status === 'ORCAMENTO_ENVIADO' || os.status === 'APROVADA') {
      await tx.itemOrcamento.updateMany({
        where: { ordemServicoId: os.id, deletedAt: null, statusCliente: { not: 'PENDENTE' } },
        data: { statusCliente: 'PENDENTE', respondidoEm: null },
      });
    }
    if (os.status !== 'EM_DIAGNOSTICO') {
      await tx.ordemServico.update({
        where: { id: os.id },
        data: { status: 'EM_DIAGNOSTICO', aprovadoEm: null },
      });
    }
  }

  private async osEditavel(ator: AtorUsuario, id: string) {
    const os = await this.carregar(ator, id);
    this.exigirEdicao(ator, os);
    if (!STATUS_EDITAVEIS.includes(os.status)) {
      throw naoPermite('O orçamento não pode mais ser alterado nesta etapa');
    }
    return os;
  }

  /** Normaliza e valida os dados de um item (origem, preço, custo, link). */
  private async montarItem(
    ator: AtorUsuario,
    dto: ItemOrcamentoDto,
    atual?: OsCompleta['itens'][number],
  ) {
    let base = {
      descricao: atual?.descricao,
      tipo: atual?.tipo,
      precoUnitarioCentavos: atual?.precoUnitarioCentavos,
      linkAfiliado: atual?.linkAfiliado ?? undefined,
      tabelaPrecoId: atual?.tabelaPrecoId ?? undefined,
    };
    if (dto.tabelaPrecoId) {
      const t = await this.banco.tenant.itemTabelaPreco.findFirst({
        where: { id: dto.tabelaPrecoId, ativo: true },
      });
      if (!t) throw new NotFoundException('Item da tabela de preços não encontrado');
      base = {
        descricao: t.nome,
        tipo: t.tipo,
        precoUnitarioCentavos: t.precoCentavos,
        linkAfiliado: t.linkAfiliadoPadrao ?? undefined,
        tabelaPrecoId: t.id,
      };
    }
    const tipo = dto.tipo ?? base.tipo;
    const descricao = dto.descricao ?? base.descricao;
    if (!tipo || !descricao)
      throw new BadRequestException('Informe a descrição e o tipo (ou um item da tabela)');

    const origemPeca = tipo === 'PECA' ? (dto.origemPeca ?? atual?.origemPeca ?? null) : null;
    if (tipo === 'PECA' && !origemPeca) {
      throw new BadRequestException(
        'Informe a origem da peça (COMPRADA_SEPARADO ou CLIENTE_COMPRA)',
      );
    }
    if (origemPeca === 'ESTOQUE') {
      throw new BadRequestException({
        codigo: 'ORIGEM_ESTOQUE_INDISPONIVEL',
        mensagem: 'Peças do estoque ficam disponíveis com o módulo de estoque',
      });
    }
    if (dto.custoUnitarioCentavos !== undefined && !podeVerCusto(ator)) {
      throw new ForbiddenException('Só o master ou quem tem permissão FINANCEIRO informa o custo');
    }

    // Peça que o cliente compra por conta própria não é cobrada pela oficina.
    const preco =
      origemPeca === 'CLIENTE_COMPRA'
        ? 0
        : (dto.precoUnitarioCentavos ?? base.precoUnitarioCentavos);
    if (preco === undefined) throw new BadRequestException('Informe o preço unitário em centavos');

    return {
      descricao,
      tipo,
      origemPeca,
      tabelaPrecoId: base.tabelaPrecoId ?? null,
      quantidade: dto.quantidade ?? atual?.quantidade ?? 1,
      precoUnitarioCentavos: preco,
      ...(dto.custoUnitarioCentavos !== undefined
        ? {
            custoUnitarioCentavos:
              origemPeca === 'CLIENTE_COMPRA' ? null : dto.custoUnitarioCentavos,
          }
        : {}),
      linkAfiliado: tipo === 'PECA' ? (dto.linkAfiliado ?? base.linkAfiliado ?? null) : null,
    };
  }

  async adicionarItem(ator: AtorUsuario, id: string, dto: ItemOrcamentoDto) {
    const os = await this.osEditavel(ator, id);
    const dados = await this.montarItem(ator, dto);
    await this.banco.sistema.$transaction(async (tx) => {
      await tx.itemOrcamento.create({
        data: { ...dados, oficinaId: os.oficinaId, ordemServicoId: os.id },
      });
      await this.aposAlterarItens(tx, os);
    });
    return this.detalhar(ator, id);
  }

  private itemDaOs(os: OsCompleta, itemId: string) {
    const item = os.itens.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Item não encontrado');
    return item;
  }

  async atualizarItem(ator: AtorUsuario, id: string, itemId: string, dto: AtualizarItemDto) {
    const os = await this.osEditavel(ator, id);
    const atual = this.itemDaOs(os, itemId);
    const dados = await this.montarItem(ator, dto, atual);
    await this.banco.sistema.$transaction(async (tx) => {
      await tx.itemOrcamento.update({ where: { id: itemId }, data: dados });
      await this.aposAlterarItens(tx, os);
    });
    return this.detalhar(ator, id);
  }

  /** Exclusão lógica. */
  async removerItem(ator: AtorUsuario, id: string, itemId: string) {
    const os = await this.osEditavel(ator, id);
    this.itemDaOs(os, itemId);
    await this.banco.sistema.$transaction(async (tx) => {
      await tx.itemOrcamento.update({ where: { id: itemId }, data: { deletedAt: new Date() } });
      await this.aposAlterarItens(tx, os);
    });
    return this.detalhar(ator, id);
  }

  /** Troca uma peça recusada por "peça trazida pelo cliente" (não cobrada). */
  async substituirPorPecaDoCliente(ator: AtorUsuario, id: string, itemId: string) {
    const os = await this.osEditavel(ator, id);
    const item = this.itemDaOs(os, itemId);
    if (item.tipo !== 'PECA' || item.origemPeca === 'CLIENTE_COMPRA') {
      throw new BadRequestException('Só peças fornecidas pela oficina podem ser substituídas');
    }
    if (item.statusCliente !== 'RECUSADO') {
      throw new BadRequestException('A peça precisa ter sido recusada pelo cliente');
    }
    await this.banco.sistema.$transaction(async (tx) => {
      await tx.itemOrcamento.create({ data: itemPecaDoCliente(item, 'PENDENTE') });
      await this.aposAlterarItens(tx, os);
    });
    return this.detalhar(ator, id);
  }

  // ----------------------------------------------------------------- fluxo

  async enviar(ator: AtorUsuario, id: string) {
    const os = await this.carregar(ator, id);
    this.exigirEdicao(ator, os);
    if (os.status !== 'ABERTA' && os.status !== 'EM_DIAGNOSTICO') {
      throw naoPermite('Só é possível enviar o orçamento em diagnóstico');
    }
    if (os.itens.length === 0)
      throw new BadRequestException('Adicione ao menos um item antes de enviar');
    await this.banco.sistema.$transaction(async (tx) => {
      // Cada envio pede a aprovação de todos os itens de novo.
      await tx.itemOrcamento.updateMany({
        where: { ordemServicoId: id, deletedAt: null },
        data: { statusCliente: 'PENDENTE', respondidoEm: null },
      });
      await tx.ordemServico.update({
        where: { id },
        data: { status: 'ORCAMENTO_ENVIADO', enviadoEm: new Date(), aprovadoEm: null },
      });
    });
    // Notificação ao cliente (push/e-mail/WhatsApp): fase 11.
    return this.detalhar(ator, id);
  }

  async iniciarExecucao(ator: AtorUsuario, id: string) {
    const os = await this.carregar(ator, id);
    this.exigirEdicao(ator, os);
    if (os.status !== 'APROVADA')
      throw naoPermite('A execução começa depois da aprovação do cliente');
    await this.banco.tenant.ordemServico.update({
      where: { id },
      data: { status: 'EM_EXECUCAO', iniciadoEm: new Date() },
    });
    return this.detalhar(ator, id);
  }

  async concluir(ator: AtorUsuario, id: string, formaPagamento?: string) {
    const os = await this.carregar(ator, id);
    this.exigirEdicao(ator, os);
    if (os.status !== 'EM_EXECUCAO') throw naoPermite('Só OS em execução podem ser concluídas');
    const agora = new Date();
    await this.banco.sistema.$transaction(async (tx) => {
      await tx.ordemServico.update({
        where: { id },
        data: {
          status: 'CONCLUIDA',
          concluidoEm: agora,
          ...(formaPagamento
            ? { statusPagamento: 'PAGO_NA_OFICINA', formaPagamento, pagoEm: agora }
            : {}),
        },
      });
      if (os.agendamentoId) {
        await tx.agendamento.update({
          where: { id: os.agendamentoId },
          data: { status: 'CONCLUIDO' },
        });
      }
    });
    return this.detalhar(ator, id);
  }

  async registrarPagamento(ator: AtorUsuario, id: string, formaPagamento: string) {
    const os = await this.carregar(ator, id);
    const podeReceber =
      podeAprovarDesconto(ator) ||
      os.mecanicoId === ator.id ||
      ator.role === 'FINANCEIRO' ||
      ator.permissoes.includes('FINANCEIRO');
    if (!podeReceber) throw new ForbiddenException('Sem permissão para registrar pagamento');
    if (!['APROVADA', 'EM_EXECUCAO', 'CONCLUIDA'].includes(os.status)) {
      throw naoPermite('Pagamento só depois da aprovação do orçamento');
    }
    if (os.statusPagamento === 'PAGO_NA_OFICINA') throw naoPermite('O pagamento já foi registrado');
    await this.banco.tenant.ordemServico.update({
      where: { id },
      data: { statusPagamento: 'PAGO_NA_OFICINA', formaPagamento, pagoEm: new Date() },
    });
    return this.detalhar(ator, id);
  }

  async cancelar(ator: AtorUsuario, id: string, motivo: string) {
    const os = await this.carregar(ator, id);
    this.exigirEdicao(ator, os);
    if (STATUS_ENCERRADOS.includes(os.status)) throw naoPermite('A OS já está encerrada');
    await this.banco.sistema.$transaction(async (tx) => {
      await tx.ordemServico.update({
        where: { id },
        data: {
          status: 'CANCELADA',
          canceladoEm: new Date(),
          canceladoPorTipo: 'USUARIO',
          canceladoPorId: ator.id,
          motivoCancelamento: motivo,
        },
      });
      await cancelarAgendamentoDaOs(tx, os.agendamentoId, 'USUARIO', motivo);
    });
    return this.detalhar(ator, id);
  }

  // ----------------------------------------------------------------- descontos

  private async parametrosDesconto(oficinaId: string) {
    return this.banco.sistema.oficina.findUniqueOrThrow({
      where: { id: oficinaId },
      select: {
        mecanicoPodeDarDesconto: true,
        limiteDescontoPercentual: true,
        limiteDescontoCentavos: true,
      },
    });
  }

  private exigirDescontoValido(dto: DescontoDto) {
    if (dto.tipo === 'PERCENTUAL' && dto.valor > 100) {
      throw new BadRequestException('Desconto percentual vai de 1 a 100');
    }
  }

  private osAberta(os: OsCompleta) {
    if (STATUS_ENCERRADOS.includes(os.status)) throw naoPermite('A OS está encerrada');
  }

  async darDescontoItem(ator: AtorUsuario, id: string, itemId: string, dto: DescontoDto) {
    this.exigirDescontoValido(dto);
    const os = await this.carregar(ator, id);
    this.osAberta(os);
    const item = this.itemDaOs(os, itemId);
    const base = valoresDoItem({ ...item, descontoStatus: null }).brutoCentavos;
    const status = decidirDesconto(
      ator,
      os.mecanicoId,
      valorDoDesconto(base, dto.tipo, dto.valor),
      base,
      await this.parametrosDesconto(os.oficinaId),
    );
    await this.banco.tenant.itemOrcamento.update({
      where: { id: itemId },
      data: {
        descontoTipo: dto.tipo,
        descontoValor: dto.valor,
        descontoStatus: status,
        descontoPorId: ator.id,
        descontoMotivo: dto.motivo ?? null,
        descontoEm: new Date(),
        descontoDecididoPorId: status === 'APLICADO' ? ator.id : null,
      },
    });
    return this.detalhar(ator, id);
  }

  async darDescontoOs(ator: AtorUsuario, id: string, dto: DescontoDto) {
    this.exigirDescontoValido(dto);
    const os = await this.carregar(ator, id);
    this.osAberta(os);
    const base = calcularTotais(os.itens, {
      descontoTipo: null,
      descontoValor: null,
      descontoStatus: null,
    }).orcado.subtotalCentavos;
    const status = decidirDesconto(
      ator,
      os.mecanicoId,
      valorDoDesconto(base, dto.tipo, dto.valor),
      base,
      await this.parametrosDesconto(os.oficinaId),
    );
    await this.banco.tenant.ordemServico.update({
      where: { id },
      data: {
        descontoTipo: dto.tipo,
        descontoValor: dto.valor,
        descontoStatus: status,
        descontoPorId: ator.id,
        descontoMotivo: dto.motivo ?? null,
        descontoEm: new Date(),
        descontoDecididoPorId: status === 'APLICADO' ? ator.id : null,
      },
    });
    return this.detalhar(ator, id);
  }

  /** Master ou gerente aprovam/recusam um desconto pendente. */
  async decidirDesconto(ator: AtorUsuario, id: string, itemId: string | null, aprovar: boolean) {
    if (!podeAprovarDesconto(ator))
      throw new ForbiddenException('Só master ou gerente aprovam descontos');
    const os = await this.carregar(ator, id);
    this.osAberta(os);
    const alvo = itemId ? this.itemDaOs(os, itemId) : os;
    if (alvo.descontoStatus !== 'PENDENTE_APROVACAO') {
      throw naoPermite('Não há desconto pendente de aprovação');
    }
    const data = {
      descontoStatus: aprovar ? ('APLICADO' as const) : ('RECUSADO' as const),
      descontoDecididoPorId: ator.id,
    };
    if (itemId) await this.banco.tenant.itemOrcamento.update({ where: { id: itemId }, data });
    else await this.banco.tenant.ordemServico.update({ where: { id }, data });
    return this.detalhar(ator, id);
  }

  /** Remove o desconto: master/gerente, ou quem pediu enquanto está pendente. */
  async removerDesconto(ator: AtorUsuario, id: string, itemId: string | null) {
    const os = await this.carregar(ator, id);
    this.osAberta(os);
    const alvo = itemId ? this.itemDaOs(os, itemId) : os;
    if (!alvo.descontoStatus) throw naoPermite('Não há desconto');
    const proprioPendente =
      alvo.descontoPorId === ator.id && alvo.descontoStatus === 'PENDENTE_APROVACAO';
    if (!podeAprovarDesconto(ator) && !proprioPendente) {
      throw new ForbiddenException('Só master ou gerente removem descontos');
    }
    const data = {
      descontoTipo: null,
      descontoValor: null,
      descontoStatus: null,
      descontoPorId: null,
      descontoMotivo: null,
      descontoEm: null,
      descontoDecididoPorId: null,
    };
    if (itemId) await this.banco.tenant.itemOrcamento.update({ where: { id: itemId }, data });
    else await this.banco.tenant.ordemServico.update({ where: { id }, data });
    return this.detalhar(ator, id);
  }

  // ----------------------------------------------------------------- fotos

  async adicionarFoto(ator: AtorUsuario, id: string, arquivo: Express.Multer.File | undefined) {
    const os = await this.carregar(ator, id);
    this.exigirEdicao(ator, os);
    this.osAberta(os);
    if ((await this.arquivos.contar(ENTIDADE_FOTO_OS, id)) >= MAX_FOTOS_POR_OS) {
      throw new BadRequestException(`Limite de ${MAX_FOTOS_POR_OS} fotos por OS`);
    }
    const salvo = await this.arquivos.salvarImagem(arquivo, {
      oficinaId: os.oficinaId,
      entidade: ENTIDADE_FOTO_OS,
      entidadeId: id,
      ator,
    });
    const fotos = await this.arquivos.listar(os.oficinaId, ENTIDADE_FOTO_OS, id);
    return fotos.find((f) => f.id === salvo.id);
  }

  async removerFoto(ator: AtorUsuario, id: string, fotoId: string) {
    const os = await this.carregar(ator, id);
    this.exigirEdicao(ator, os);
    await this.arquivos.remover(fotoId, ENTIDADE_FOTO_OS, id);
  }

  // ----------------------------------------------------------------- histórico

  /**
   * Histórico do veículo nesta oficina: todas as OS e agendamentos dele, de qualquer mecânico.
   * Decisão do produto: o mecânico vê o histórico completo do veículo (para diagnosticar),
   * mas o detalhe de OS de outro mecânico continua restrito (seção 4.2). Custo nunca aparece.
   */
  async historicoVeiculo(ator: AtorUsuario, veiculoId: string) {
    const vinculo = await this.banco.tenant.veiculoOficina.findFirst({
      where: { veiculoId },
      select: {
        veiculo: { select: { id: true, placa: true, marca: true, modelo: true, ano: true } },
      },
    });
    if (!vinculo) throw new NotFoundException('Veículo não encontrado');
    const ordens = await this.banco.tenant.ordemServico.findMany({
      where: { veiculoId },
      include: INCLUDE_OS,
      orderBy: { createdAt: 'desc' },
    });
    const agendamentos = await this.banco.tenant.agendamento.findMany({
      where: { veiculoId },
      select: { id: true, inicio: true, status: true, tipoServico: true },
      orderBy: { inicio: 'desc' },
    });
    return {
      veiculo: vinculo.veiculo,
      ordensServico: ordens.map((os) => {
        const a = apresentarParaOficina(os, ator);
        return {
          id: a.id,
          numero: a.numero,
          status: a.status,
          kmEntrada: a.kmEntrada,
          diagnostico: a.diagnostico,
          createdAt: a.createdAt,
          concluidoEm: a.concluidoEm,
          mecanico: a.mecanico,
          servicos: a.itens.filter((i) => i.statusCliente === 'APROVADO').map((i) => i.descricao),
          totalCentavos: a.totais.aprovado.totalCentavos,
        };
      }),
      agendamentos,
    };
  }
}

/** Item "peça trazida pelo cliente" que substitui uma peça recusada (não é cobrado). */
export function itemPecaDoCliente(
  item: OsCompleta['itens'][number],
  statusCliente: 'PENDENTE' | 'APROVADO',
): Prisma.ItemOrcamentoUncheckedCreateInput {
  return {
    oficinaId: item.oficinaId,
    ordemServicoId: item.ordemServicoId,
    descricao: `Peça trazida pelo cliente: ${item.descricao}`.slice(0, 300),
    tipo: 'PECA',
    origemPeca: 'CLIENTE_COMPRA',
    quantidade: item.quantidade,
    precoUnitarioCentavos: 0,
    linkAfiliado: item.linkAfiliado,
    statusCliente,
    respondidoEm: statusCliente === 'APROVADO' ? new Date() : null,
    substituiItemId: item.id,
  };
}

/** Cancela o agendamento ligado à OS, se ainda estiver ativo. */
export async function cancelarAgendamentoDaOs(
  tx: Tx,
  agendamentoId: string | null,
  porTipo: 'USUARIO' | 'CLIENTE',
  motivo?: string,
) {
  if (!agendamentoId) return;
  await tx.agendamento.updateMany({
    where: { id: agendamentoId, status: { in: ['AGENDADO', 'CONFIRMADO', 'EM_ATENDIMENTO'] } },
    data: {
      status: 'CANCELADO',
      canceladoEm: new Date(),
      canceladoPorTipo: porTipo,
      motivoCancelamento: motivo ?? 'OS cancelada',
    },
  });
}
