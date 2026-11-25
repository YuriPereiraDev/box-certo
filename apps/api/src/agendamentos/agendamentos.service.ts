import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AtoresService } from '../auth/atores.service.js';
import type { AtorCliente, AtorUsuario } from '../common/contexto/contexto.js';
import { dataLocal, diaDaSemana, localParaUtc, somarDias } from '../common/utils/datas.js';
import { horaParaMinutos } from '../common/utils/documentos.js';
import { minutosLocais } from '../common/utils/datas.js';
import { ROLES_QUE_CONTAM } from '../common/utils/plano.service.js';
import type { Prisma, StatusAgendamento } from '../generated/prisma/client.js';
import { BancoService, type ClienteSistema } from '../prisma/banco.service.js';
import type {
  AlterarStatusDto,
  CriarAgendamentoClienteDto,
  CriarAgendamentoOficinaDto,
  FiltroAgendamentosDto,
} from './agendamentos.dto.js';
import {
  cabeNoExpediente,
  calcularSlots,
  STATUS_QUE_OCUPAM,
  temMecanicoLivre,
  type HorarioDoDia,
  type Ocupacao,
} from './disponibilidade.js';

type Tx = Parameters<Parameters<ClienteSistema['$transaction']>[0]>[0];
type Db = Tx | ClienteSistema;

/** Transições permitidas pela oficina. */
const TRANSICOES: Record<StatusAgendamento, StatusAgendamento[]> = {
  AGENDADO: ['CONFIRMADO', 'EM_ATENDIMENTO', 'CANCELADO', 'NAO_COMPARECEU'],
  CONFIRMADO: ['EM_ATENDIMENTO', 'CANCELADO', 'NAO_COMPARECEU'],
  EM_ATENDIMENTO: ['CONCLUIDO', 'CANCELADO'],
  CONCLUIDO: [],
  CANCELADO: [],
  NAO_COMPARECEU: [],
};

export function transicaoPermitida(de: StatusAgendamento, para: StatusAgendamento): boolean {
  return TRANSICOES[de].includes(para);
}

const SELECAO_AGENDAMENTO = {
  id: true,
  oficinaId: true,
  tipoServico: true,
  inicio: true,
  fim: true,
  status: true,
  observacaoCliente: true,
  observacaoOficina: true,
  criadoPorTipo: true,
  canceladoEm: true,
  canceladoPorTipo: true,
  motivoCancelamento: true,
  createdAt: true,
  updatedAt: true,
  cliente: { select: { id: true, nome: true, telefone: true } },
  veiculo: { select: { id: true, placa: true, marca: true, modelo: true, cor: true } },
  mecanico: { select: { id: true, nome: true } },
} as const;

/** O que o cliente vê (sem observações internas da oficina). */
const SELECAO_AGENDAMENTO_CLIENTE = {
  id: true,
  tipoServico: true,
  inicio: true,
  fim: true,
  status: true,
  observacaoCliente: true,
  canceladoEm: true,
  motivoCancelamento: true,
  createdAt: true,
  oficina: { select: { id: true, nome: true, telefone: true } },
  veiculo: { select: { id: true, placa: true, marca: true, modelo: true } },
  mecanico: { select: { nome: true } },
} as const;

interface ConfigAgenda {
  duracaoPadraoAgendamentoMin: number;
  passoAgendaMin: number;
  janelaAgendamentoDias: number;
  antecedenciaCancelamentoHoras: number;
}

interface PedidoHorario {
  oficinaId: string;
  inicio: Date;
  fim: Date;
  mecanicoId?: string | null;
  ignorarId?: string;
  /** Cliente só pode escolher horários da grade (de passo em passo). */
  exigirGrade: boolean;
}

const indisponivel = () =>
  new ConflictException({
    codigo: 'HORARIO_INDISPONIVEL',
    mensagem: 'Este horário não está mais disponível. Escolha outro.',
  });

/** Violação da constraint de exclusão do banco (mesmo mecânico em horários sobrepostos). */
function ehConflitoNoBanco(erro: unknown): boolean {
  const texto = `${(erro as Error)?.message ?? ''} ${JSON.stringify((erro as { meta?: unknown })?.meta ?? '')}`;
  return texto.includes('agendamento_sem_conflito_mecanico') || texto.includes('23P01');
}

@Injectable()
export class AgendamentosService {
  constructor(
    private readonly banco: BancoService,
    private readonly atores: AtoresService,
  ) {}

  // ------------------------------------------------------------- disponibilidade

  private async config(db: Db, oficinaId: string): Promise<ConfigAgenda & { status: string }> {
    const oficina = await db.oficina.findUnique({
      where: { id: oficinaId },
      select: {
        status: true,
        duracaoPadraoAgendamentoMin: true,
        passoAgendaMin: true,
        janelaAgendamentoDias: true,
        antecedenciaCancelamentoHoras: true,
      },
    });
    if (!oficina) throw new NotFoundException('Oficina não encontrada');
    return oficina;
  }

  private async horarioDoDia(
    db: Db,
    oficinaId: string,
    data: string,
  ): Promise<HorarioDoDia | null> {
    return db.horarioFuncionamento.findFirst({
      where: { oficinaId, diaSemana: diaDaSemana(data), ativo: true },
      select: { abre: true, fecha: true, intervaloInicio: true, intervaloFim: true },
    });
  }

  private async mecanicosAtivos(db: Db, oficinaId: string): Promise<string[]> {
    const lista = await db.user.findMany({
      where: { oficinaId, ativo: true, role: { in: [...ROLES_QUE_CONTAM] } },
      select: { id: true },
    });
    return lista.map((m) => m.id);
  }

  private ocupacoesDoDia(db: Db, oficinaId: string, data: string): Promise<Ocupacao[]> {
    return db.agendamento.findMany({
      where: {
        oficinaId,
        status: { in: [...STATUS_QUE_OCUPAM] },
        inicio: { lt: localParaUtc(somarDias(data, 1), 0) },
        fim: { gt: localParaUtc(data, 0) },
      },
      select: { id: true, inicio: true, fim: true, mecanicoId: true },
    });
  }

  async disponibilidade(
    oficinaId: string,
    data: string,
    dias: number,
    opcoes: { mecanicoId?: string; duracaoMin?: number; limitarJanela?: boolean } = {},
  ) {
    const db = this.banco.sistema;
    const cfg = await this.config(db, oficinaId);
    const duracaoMin = opcoes.duracaoMin ?? cfg.duracaoPadraoAgendamentoMin;
    const mecanicos = await this.mecanicosAtivos(db, oficinaId);
    const agora = new Date();
    const limite = new Date(agora.getTime() + cfg.janelaAgendamentoDias * 86_400_000);

    const resultado = [];
    for (let i = 0; i < dias; i++) {
      const dia = somarDias(data, i);
      const slots = calcularSlots({
        data: dia,
        horario: await this.horarioDoDia(db, oficinaId, dia),
        duracaoMin,
        passoMin: cfg.passoAgendaMin,
        agora,
        mecanicosAtivos: mecanicos,
        ocupacoes: await this.ocupacoesDoDia(db, oficinaId, dia),
        mecanicoId: opcoes.mecanicoId,
      }).filter((s) => !opcoes.limitarJanela || s.inicio <= limite);
      resultado.push({ data: dia, duracaoMin, horarios: slots });
    }
    return resultado;
  }

  /**
   * Confere expediente e capacidade dentro da transação (com a trava da oficina já tomada).
   * Lança 400 fora do expediente e 409 se não houver mecânico livre.
   */
  private async verificarHorario(tx: Tx, p: PedidoHorario): Promise<void> {
    if (p.inicio <= new Date()) {
      throw new BadRequestException({
        codigo: 'HORARIO_NO_PASSADO',
        mensagem: 'Escolha um horário futuro',
      });
    }
    const data = dataLocal(p.inicio);
    const horario = await this.horarioDoDia(tx, p.oficinaId, data);
    if (!cabeNoExpediente(horario, p.inicio, p.fim)) {
      throw new BadRequestException({
        codigo: 'FORA_DO_EXPEDIENTE',
        mensagem: 'O horário está fora do expediente da oficina',
      });
    }
    if (p.exigirGrade && horario) {
      const cfg = await this.config(tx, p.oficinaId);
      const desde = minutosLocais(p.inicio) - horaParaMinutos(horario.abre);
      if (desde % cfg.passoAgendaMin !== 0 || p.inicio.getUTCSeconds() !== 0) throw indisponivel();
    }
    const livre = temMecanicoLivre(
      { inicio: p.inicio, fim: p.fim },
      await this.mecanicosAtivos(tx, p.oficinaId),
      await this.ocupacoesDoDia(tx, p.oficinaId, data),
      { mecanicoId: p.mecanicoId, ignorarId: p.ignorarId },
    );
    if (!livre) throw indisponivel();
  }

  /** Executa com a trava da oficina: duas reservas simultâneas não pegam o mesmo horário. */
  private async comTrava<T>(oficinaId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.banco.sistema.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${oficinaId}))) t`;
        return fn(tx);
      });
    } catch (erro) {
      if (ehConflitoNoBanco(erro)) throw indisponivel();
      throw erro;
    }
  }

  private async vincularVeiculo(tx: Tx, veiculoId: string, oficinaId: string) {
    await tx.veiculoOficina.upsert({
      where: { veiculoId_oficinaId: { veiculoId, oficinaId } },
      update: {},
      create: { veiculoId, oficinaId },
    });
  }

  // ----------------------------------------------------------------- cliente

  private async exigirVinculo(clienteId: string, oficinaId: string) {
    const vinculo = await this.banco.sistema.clienteOficina.findUnique({
      where: { clienteId_oficinaId: { clienteId, oficinaId } },
      select: { oficina: { select: { status: true, deletedAt: true } } },
    });
    if (!vinculo || vinculo.oficina.deletedAt)
      throw new NotFoundException('Oficina não encontrada');
    this.atores.verificarStatusOficina(vinculo.oficina.status);
  }

  async disponibilidadeParaCliente(
    cliente: AtorCliente,
    oficinaId: string,
    data: string,
    dias: number,
  ) {
    await this.exigirVinculo(cliente.id, oficinaId);
    return this.disponibilidade(oficinaId, data, dias, { limitarJanela: true });
  }

  async criarPeloCliente(cliente: AtorCliente, dto: CriarAgendamentoClienteDto) {
    await this.exigirVinculo(cliente.id, dto.oficinaId);
    const veiculo = await this.banco.sistema.veiculo.findFirst({
      where: { id: dto.veiculoId, clienteId: cliente.id, ativo: true },
      select: { id: true },
    });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado');

    const cfg = await this.config(this.banco.sistema, dto.oficinaId);
    if (dto.inicio.getTime() > Date.now() + cfg.janelaAgendamentoDias * 86_400_000) {
      throw new BadRequestException({
        codigo: 'FORA_DA_JANELA',
        mensagem: `A oficina aceita agendamentos para até ${cfg.janelaAgendamentoDias} dias à frente`,
      });
    }
    const fim = new Date(dto.inicio.getTime() + cfg.duracaoPadraoAgendamentoMin * 60_000);

    return this.comTrava(dto.oficinaId, async (tx) => {
      await this.verificarHorario(tx, {
        oficinaId: dto.oficinaId,
        inicio: dto.inicio,
        fim,
        exigirGrade: true,
      });
      await this.vincularVeiculo(tx, veiculo.id, dto.oficinaId);
      return tx.agendamento.create({
        data: {
          oficinaId: dto.oficinaId,
          clienteId: cliente.id,
          veiculoId: veiculo.id,
          tipoServico: dto.tipoServico,
          observacaoCliente: dto.observacaoCliente,
          inicio: dto.inicio,
          fim,
          status: 'AGENDADO',
          criadoPorTipo: 'CLIENTE',
          criadoPorId: cliente.id,
        },
        select: SELECAO_AGENDAMENTO_CLIENTE,
      });
    });
  }

  listarDoCliente(cliente: AtorCliente, futuros?: boolean) {
    return this.banco.sistema.agendamento.findMany({
      where: { clienteId: cliente.id, ...(futuros ? { fim: { gte: new Date() } } : {}) },
      select: SELECAO_AGENDAMENTO_CLIENTE,
      orderBy: { inicio: futuros ? 'asc' : 'desc' },
    });
  }

  async detalharDoCliente(cliente: AtorCliente, id: string) {
    const ag = await this.banco.sistema.agendamento.findFirst({
      where: { id, clienteId: cliente.id },
      select: { ...SELECAO_AGENDAMENTO_CLIENTE, oficinaId: true, mecanicoId: true },
    });
    if (!ag) throw new NotFoundException('Agendamento não encontrado');
    return ag;
  }

  /** Regra 7.2: o cliente reagenda/cancela até X horas antes (padrão 2h). */
  private async exigirPrazoDoCliente(
    oficinaId: string,
    inicioAtual: Date,
    status: StatusAgendamento,
  ) {
    if (status !== 'AGENDADO' && status !== 'CONFIRMADO') {
      throw new UnprocessableEntityException({
        codigo: 'STATUS_NAO_PERMITE',
        mensagem: 'Este agendamento não pode mais ser alterado',
      });
    }
    const { antecedenciaCancelamentoHoras: horas } = await this.config(
      this.banco.sistema,
      oficinaId,
    );
    if (Date.now() > inicioAtual.getTime() - horas * 3_600_000) {
      throw new UnprocessableEntityException({
        codigo: 'PRAZO_ENCERRADO',
        mensagem: `Alterações pelo app só até ${horas}h antes do horário. Fale com a oficina.`,
      });
    }
  }

  async reagendarPeloCliente(cliente: AtorCliente, id: string, inicio: Date) {
    const atual = await this.detalharDoCliente(cliente, id);
    await this.exigirPrazoDoCliente(atual.oficinaId, atual.inicio, atual.status);
    const cfg = await this.config(this.banco.sistema, atual.oficinaId);
    if (inicio.getTime() > Date.now() + cfg.janelaAgendamentoDias * 86_400_000) {
      throw new BadRequestException({ codigo: 'FORA_DA_JANELA', mensagem: 'Data muito distante' });
    }
    const duracao = atual.fim.getTime() - atual.inicio.getTime();
    const fim = new Date(inicio.getTime() + duracao);

    return this.comTrava(atual.oficinaId, async (tx) => {
      // Mantém o mecânico se ele estiver livre no novo horário; senão a oficina atribui de novo.
      let mecanicoId = atual.mecanicoId;
      const pedido = { oficinaId: atual.oficinaId, inicio, fim, ignorarId: id, exigirGrade: true };
      try {
        await this.verificarHorario(tx, { ...pedido, mecanicoId });
      } catch (erro) {
        if (!mecanicoId || !(erro instanceof ConflictException)) throw erro;
        mecanicoId = null;
        await this.verificarHorario(tx, { ...pedido, mecanicoId });
      }
      return tx.agendamento.update({
        where: { id },
        data: { inicio, fim, mecanicoId, status: 'AGENDADO' },
        select: SELECAO_AGENDAMENTO_CLIENTE,
      });
    });
  }

  async cancelarPeloCliente(cliente: AtorCliente, id: string, motivo?: string) {
    const atual = await this.detalharDoCliente(cliente, id);
    await this.exigirPrazoDoCliente(atual.oficinaId, atual.inicio, atual.status);
    return this.banco.sistema.agendamento.update({
      where: { id },
      data: {
        status: 'CANCELADO',
        canceladoEm: new Date(),
        canceladoPorTipo: 'CLIENTE',
        motivoCancelamento: motivo,
      },
      select: SELECAO_AGENDAMENTO_CLIENTE,
    });
  }

  // ----------------------------------------------------------------- oficina

  /** Mecânico sem GERENTE só vê a própria agenda (seção 4.2). */
  private veSoOProprio(ator: AtorUsuario): boolean {
    return ator.role === 'MECANICO' && !ator.permissoes.includes('GERENTE');
  }

  private podeGerir(ator: AtorUsuario): boolean {
    return !this.veSoOProprio(ator);
  }

  private filtroVisibilidade(ator: AtorUsuario): Prisma.AgendamentoWhereInput {
    return this.veSoOProprio(ator) ? { mecanicoId: ator.id } : {};
  }

  listarDaOficina(ator: AtorUsuario, f: FiltroAgendamentosDto) {
    return this.banco.tenant.agendamento.findMany({
      where: {
        ...this.filtroVisibilidade(ator),
        status: f.status,
        ...(f.mecanicoId && !this.veSoOProprio(ator) ? { mecanicoId: f.mecanicoId } : {}),
        ...(f.semMecanico && !this.veSoOProprio(ator) ? { mecanicoId: null } : {}),
        inicio: {
          gte: f.de ? localParaUtc(f.de, 0) : undefined,
          lt: f.ate ? localParaUtc(somarDias(f.ate, 1), 0) : undefined,
        },
      },
      select: SELECAO_AGENDAMENTO,
      orderBy: { inicio: 'asc' },
    });
  }

  async detalharDaOficina(ator: AtorUsuario, id: string) {
    const ag = await this.banco.tenant.agendamento.findFirst({
      where: { id, ...this.filtroVisibilidade(ator) },
      select: { ...SELECAO_AGENDAMENTO, mecanicoId: true },
    });
    if (!ag) throw new NotFoundException('Agendamento não encontrado');
    return ag;
  }

  /** O mecânico precisa ser master/mecânico ativo desta oficina (busca pelo tenant). */
  private async exigirMecanicoDaOficina(mecanicoId: string) {
    const m = await this.banco.tenant.user.findFirst({
      where: { id: mecanicoId, ativo: true, role: { in: [...ROLES_QUE_CONTAM] } },
      select: { id: true },
    });
    if (!m) throw new BadRequestException('Mecânico inválido ou inativo');
  }

  async criarPelaOficina(ator: AtorUsuario, dto: CriarAgendamentoOficinaDto) {
    const oficinaId = ator.oficinaId;
    const vinculo = await this.banco.tenant.clienteOficina.findFirst({
      where: { clienteId: dto.clienteId },
    });
    if (!vinculo) throw new NotFoundException('Cliente não encontrado');
    const veiculo = await this.banco.sistema.veiculo.findFirst({
      where: { id: dto.veiculoId, clienteId: dto.clienteId, ativo: true },
      select: { id: true },
    });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado');

    let mecanicoId = dto.mecanicoId ?? null;
    if (this.veSoOProprio(ator)) {
      if (mecanicoId && mecanicoId !== ator.id) {
        throw new ForbiddenException('Mecânico só pode agendar para si mesmo');
      }
      mecanicoId = ator.id;
    }
    if (mecanicoId) await this.exigirMecanicoDaOficina(mecanicoId);

    const cfg = await this.config(this.banco.sistema, oficinaId);
    const fim = new Date(
      dto.inicio.getTime() + (dto.duracaoMin ?? cfg.duracaoPadraoAgendamentoMin) * 60_000,
    );

    return this.comTrava(oficinaId, async (tx) => {
      await this.verificarHorario(tx, {
        oficinaId,
        inicio: dto.inicio,
        fim,
        mecanicoId,
        exigirGrade: false,
      });
      await this.vincularVeiculo(tx, veiculo.id, oficinaId);
      return tx.agendamento.create({
        data: {
          oficinaId,
          clienteId: dto.clienteId,
          veiculoId: veiculo.id,
          mecanicoId,
          tipoServico: dto.tipoServico,
          observacaoOficina: dto.observacaoOficina,
          inicio: dto.inicio,
          fim,
          status: 'CONFIRMADO',
          criadoPorTipo: 'USUARIO',
          criadoPorId: ator.id,
        },
        select: SELECAO_AGENDAMENTO,
      });
    });
  }

  async reagendarPelaOficina(ator: AtorUsuario, id: string, inicio: Date, duracaoMin?: number) {
    const atual = await this.detalharDaOficina(ator, id);
    if (atual.status !== 'AGENDADO' && atual.status !== 'CONFIRMADO') {
      throw new UnprocessableEntityException({
        codigo: 'STATUS_NAO_PERMITE',
        mensagem: 'Só agendamentos agendados ou confirmados podem ser remarcados',
      });
    }
    const duracao = duracaoMin ? duracaoMin * 60_000 : atual.fim.getTime() - atual.inicio.getTime();
    const fim = new Date(inicio.getTime() + duracao);
    return this.comTrava(ator.oficinaId, async (tx) => {
      await this.verificarHorario(tx, {
        oficinaId: ator.oficinaId,
        inicio,
        fim,
        mecanicoId: atual.mecanicoId,
        ignorarId: id,
        exigirGrade: false,
      });
      return tx.agendamento.update({
        where: { id, oficinaId: ator.oficinaId },
        data: { inicio, fim },
        select: SELECAO_AGENDAMENTO,
      });
    });
  }

  /**
   * MASTER/GERENTE (e quem não é mecânico comum) atribuem qualquer mecânico.
   * Mecânico comum só pode assumir um agendamento sem mecânico.
   */
  async atribuirMecanico(ator: AtorUsuario, id: string, mecanicoId: string | null) {
    const atual = this.veSoOProprio(ator)
      ? await this.banco.tenant.agendamento.findFirst({
          where: { id, OR: [{ mecanicoId: null }, { mecanicoId: ator.id }] },
          select: { ...SELECAO_AGENDAMENTO, mecanicoId: true },
        })
      : await this.detalharDaOficina(ator, id);
    if (!atual) throw new NotFoundException('Agendamento não encontrado');
    if (this.veSoOProprio(ator) && mecanicoId !== ator.id) {
      throw new ForbiddenException('Mecânico só pode assumir o agendamento para si');
    }
    if (!(STATUS_QUE_OCUPAM as readonly string[]).includes(atual.status)) {
      throw new UnprocessableEntityException({
        codigo: 'STATUS_NAO_PERMITE',
        mensagem: 'Agendamento encerrado não pode ser reatribuído',
      });
    }
    if (mecanicoId) await this.exigirMecanicoDaOficina(mecanicoId);

    return this.comTrava(ator.oficinaId, async (tx) => {
      if (mecanicoId) {
        const livre = temMecanicoLivre(
          atual,
          await this.mecanicosAtivos(tx, ator.oficinaId),
          await this.ocupacoesDoDia(tx, ator.oficinaId, dataLocal(atual.inicio)),
          { mecanicoId, ignorarId: id },
        );
        if (!livre) {
          throw new ConflictException({
            codigo: 'MECANICO_OCUPADO',
            mensagem: 'O mecânico já tem outro atendimento neste horário',
          });
        }
      }
      return tx.agendamento.update({
        where: { id, oficinaId: ator.oficinaId },
        data: { mecanicoId },
        select: SELECAO_AGENDAMENTO,
      });
    });
  }

  async alterarStatus(ator: AtorUsuario, id: string, dto: AlterarStatusDto) {
    const atual = await this.detalharDaOficina(ator, id);
    if (!transicaoPermitida(atual.status, dto.status)) {
      throw new UnprocessableEntityException({
        codigo: 'TRANSICAO_INVALIDA',
        mensagem: `Não é possível passar de ${atual.status} para ${dto.status}`,
      });
    }
    const cancelando = dto.status === 'CANCELADO';
    return this.banco.tenant.agendamento.update({
      where: { id },
      data: {
        status: dto.status,
        ...(cancelando
          ? { canceladoEm: new Date(), canceladoPorTipo: 'USUARIO', motivoCancelamento: dto.motivo }
          : {}),
      },
      select: SELECAO_AGENDAMENTO,
    });
  }

  /** Agenda do dia agrupada por mecânico (+ "sem mecânico"). */
  async agendaPorMecanico(ator: AtorUsuario, data: string, dias: number) {
    const agendamentos = await this.banco.tenant.agendamento.findMany({
      where: {
        ...this.filtroVisibilidade(ator),
        status: { not: 'CANCELADO' },
        inicio: { gte: localParaUtc(data, 0), lt: localParaUtc(somarDias(data, dias), 0) },
      },
      select: { ...SELECAO_AGENDAMENTO, mecanicoId: true },
      orderBy: { inicio: 'asc' },
    });
    const mecanicos = await this.banco.tenant.user.findMany({
      where: {
        ativo: true,
        role: { in: [...ROLES_QUE_CONTAM] },
        ...(this.veSoOProprio(ator) ? { id: ator.id } : {}),
      },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
    const semMascara = ({ mecanicoId: _m, ...a }: (typeof agendamentos)[number]) => a;
    return {
      de: data,
      ate: somarDias(data, dias - 1),
      mecanicos: mecanicos.map((m) => ({
        mecanico: m,
        agendamentos: agendamentos.filter((a) => a.mecanicoId === m.id).map(semMascara),
      })),
      semMecanico: this.podeGerir(ator)
        ? agendamentos.filter((a) => !a.mecanicoId).map(semMascara)
        : [],
    };
  }
}
