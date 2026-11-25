import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores } from '../common/auth/decorators.js';
import type { AtorCliente, AtorUsuario } from '../common/contexto/contexto.js';
import {
  AlterarStatusDto,
  AtribuirMecanicoDto,
  CancelarDto,
  CriarAgendamentoClienteDto,
  CriarAgendamentoOficinaDto,
  FiltroAgendaDto,
  FiltroAgendamentosClienteDto,
  FiltroAgendamentosDto,
  FiltroDisponibilidadeDto,
  FiltroDisponibilidadeOficinaDto,
  ReagendarClienteDto,
  ReagendarOficinaDto,
} from './agendamentos.dto.js';
import { AgendamentosService } from './agendamentos.service.js';

@ApiTags('Oficina — Agendamentos')
@ApiBearerAuth()
@Controller('oficina')
@Atores('USUARIO')
export class AgendamentosOficinaController {
  constructor(private readonly agendamentos: AgendamentosService) {}

  @Get('agendamentos/disponibilidade')
  @ApiOperation({ summary: 'Horários livres (por mecânico e duração, opcionais)' })
  disponibilidade(@AtorAtual() ator: AtorUsuario, @Query() f: FiltroDisponibilidadeOficinaDto) {
    return this.agendamentos.disponibilidade(ator.oficinaId, f.data, f.dias, {
      mecanicoId: f.mecanicoId,
      duracaoMin: f.duracaoMin,
    });
  }

  @Get('agenda')
  @ApiOperation({
    summary: 'Agenda agrupada por mecânico',
    description: 'Mecânico sem GERENTE vê só a própria agenda.',
  })
  agenda(@AtorAtual() ator: AtorUsuario, @Query() f: FiltroAgendaDto) {
    return this.agendamentos.agendaPorMecanico(ator, f.data, f.dias);
  }

  @Get('agendamentos')
  @ApiOperation({ summary: 'Lista agendamentos (mecânico sem GERENTE vê só os seus)' })
  listar(@AtorAtual() ator: AtorUsuario, @Query() f: FiltroAgendamentosDto) {
    return this.agendamentos.listarDaOficina(ator, f);
  }

  @Get('agendamentos/:id')
  @ApiOperation({ summary: 'Detalha um agendamento' })
  detalhar(@AtorAtual() ator: AtorUsuario, @Param('id', ParseUUIDPipe) id: string) {
    return this.agendamentos.detalharDaOficina(ator, id);
  }

  @Post('agendamentos')
  @Auditar({ acao: 'AGENDAMENTO_CRIADO_PELA_OFICINA', entidade: 'Agendamento' })
  @ApiOperation({
    summary: 'Agenda no balcão/telefone (já confirmado)',
    description: '409 HORARIO_INDISPONIVEL; 400 FORA_DO_EXPEDIENTE.',
  })
  criar(@AtorAtual() ator: AtorUsuario, @Body() dto: CriarAgendamentoOficinaDto) {
    return this.agendamentos.criarPelaOficina(ator, dto);
  }

  @Patch('agendamentos/:id/reagendar')
  @Auditar({ acao: 'AGENDAMENTO_REAGENDADO_PELA_OFICINA', entidade: 'Agendamento' })
  @ApiOperation({ summary: 'Remarca o horário' })
  reagendar(
    @AtorAtual() ator: AtorUsuario,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReagendarOficinaDto,
  ) {
    return this.agendamentos.reagendarPelaOficina(ator, id, dto.inicio, dto.duracaoMin);
  }

  @Patch('agendamentos/:id/mecanico')
  @Auditar({ acao: 'AGENDAMENTO_MECANICO_ATRIBUIDO', entidade: 'Agendamento' })
  @ApiOperation({
    summary: 'Atribui ou tira o mecânico',
    description: 'MASTER/GERENTE atribuem qualquer um; mecânico comum só assume para si.',
  })
  atribuir(
    @AtorAtual() ator: AtorUsuario,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtribuirMecanicoDto,
  ) {
    return this.agendamentos.atribuirMecanico(ator, id, dto.mecanicoId);
  }

  @Patch('agendamentos/:id/status')
  @Auditar({ acao: 'AGENDAMENTO_STATUS_ALTERADO', entidade: 'Agendamento' })
  @ApiOperation({ summary: 'Confirma, inicia, conclui, cancela ou marca falta' })
  status(
    @AtorAtual() ator: AtorUsuario,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AlterarStatusDto,
  ) {
    return this.agendamentos.alterarStatus(ator, id, dto);
  }
}

@ApiTags('Cliente — Agendamentos')
@ApiBearerAuth()
@Controller('cliente')
@Atores('CLIENTE')
export class AgendamentosClienteController {
  constructor(private readonly agendamentos: AgendamentosService) {}

  @Get('oficinas/:oficinaId/disponibilidade')
  @ApiOperation({ summary: 'Horários livres de uma oficina vinculada' })
  disponibilidade(
    @AtorAtual() ator: AtorCliente,
    @Param('oficinaId', ParseUUIDPipe) oficinaId: string,
    @Query() f: FiltroDisponibilidadeDto,
  ) {
    return this.agendamentos.disponibilidadeParaCliente(ator, oficinaId, f.data, f.dias);
  }

  @Get('agendamentos')
  @ApiOperation({ summary: 'Meus agendamentos' })
  listar(@AtorAtual() ator: AtorCliente, @Query() f: FiltroAgendamentosClienteDto) {
    return this.agendamentos.listarDoCliente(ator, f.futuros);
  }

  @Get('agendamentos/:id')
  @ApiOperation({ summary: 'Detalha um agendamento meu' })
  async detalhar(@AtorAtual() ator: AtorCliente, @Param('id', ParseUUIDPipe) id: string) {
    const {
      oficinaId: _o,
      mecanicoId: _m,
      ...ag
    } = await this.agendamentos.detalharDoCliente(ator, id);
    return ag;
  }

  @Post('agendamentos')
  @Auditar({ acao: 'AGENDAMENTO_CRIADO_PELO_CLIENTE', entidade: 'Agendamento' })
  @ApiOperation({
    summary: 'Agenda um horário da grade de disponibilidade',
    description: '409 HORARIO_INDISPONIVEL quando o horário foi ocupado.',
  })
  criar(@AtorAtual() ator: AtorCliente, @Body() dto: CriarAgendamentoClienteDto) {
    return this.agendamentos.criarPeloCliente(ator, dto);
  }

  @Patch('agendamentos/:id/reagendar')
  @Auditar({ acao: 'AGENDAMENTO_REAGENDADO_PELO_CLIENTE', entidade: 'Agendamento' })
  @ApiOperation({
    summary: 'Reagenda (até X horas antes; padrão 2h)',
    description: '422 PRAZO_ENCERRADO depois do prazo.',
  })
  reagendar(
    @AtorAtual() ator: AtorCliente,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReagendarClienteDto,
  ) {
    return this.agendamentos.reagendarPeloCliente(ator, id, dto.inicio);
  }

  @Patch('agendamentos/:id/cancelar')
  @Auditar({ acao: 'AGENDAMENTO_CANCELADO_PELO_CLIENTE', entidade: 'Agendamento' })
  @ApiOperation({ summary: 'Cancela (até X horas antes; padrão 2h)' })
  cancelar(
    @AtorAtual() ator: AtorCliente,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelarDto,
  ) {
    return this.agendamentos.cancelarPeloCliente(ator, id, dto.motivo);
  }
}
