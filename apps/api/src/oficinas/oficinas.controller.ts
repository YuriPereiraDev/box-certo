import { Body, Controller, Get, Patch, Post, Put, UploadedFile } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores, ExigeRole, Publico } from '../common/auth/decorators.js';
import { LimiteLogin } from '../common/auth/limites.js';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import {
  AtualizarOficinaDto,
  CadastroOficinaDto,
  ConfigAgendamentoDto,
  ConfigDescontosDto,
  HorariosDto,
} from './oficinas.dto.js';
import { DocUpload, uploadImagem } from '../arquivos/upload.decorators.js';
import { OficinasService } from './oficinas.service.js';

@ApiTags('Público')
@Controller('publico')
@Publico()
export class OficinasPublicoController {
  constructor(private readonly oficinas: OficinasService) {}

  @Get('planos')
  @ApiOperation({ summary: 'Planos disponíveis para assinatura' })
  planos() {
    return this.oficinas.listarPlanos();
  }

  @Post('oficinas')
  @LimiteLogin()
  @Auditar({ acao: 'OFICINA_CADASTRADA' })
  @ApiOperation({
    summary: 'Autocadastro de oficina',
    description:
      'Cria a oficina em TESTE por 14 dias e o usuário MASTER; devolve a sessão já logada.',
  })
  @ApiCreatedResponse({ description: 'Oficina criada; tokens do master' })
  cadastrar(@Body() dto: CadastroOficinaDto) {
    return this.oficinas.cadastrar(dto);
  }
}

@ApiTags('Oficina — Dados e configurações')
@ApiBearerAuth()
@Controller('oficina')
@Atores('USUARIO')
export class OficinaController {
  constructor(private readonly oficinas: OficinasService) {}

  @Get()
  @ApiOperation({ summary: 'Dados da oficina, plano e configurações' })
  dados(@AtorAtual() ator: AtorUsuario) {
    return this.oficinas.dados(ator.oficinaId);
  }

  @Patch()
  @ExigeRole('MASTER')
  @Auditar({ acao: 'OFICINA_DADOS_ATUALIZADOS' })
  @ApiOperation({ summary: 'Atualiza os dados cadastrais (só MASTER)' })
  atualizar(@AtorAtual() ator: AtorUsuario, @Body() dto: AtualizarOficinaDto) {
    return this.oficinas.atualizar(ator.oficinaId, dto);
  }

  @Put('logo')
  @ExigeRole('MASTER')
  @uploadImagem()
  @DocUpload()
  @Auditar({ acao: 'OFICINA_LOGO_ALTERADO', entidade: 'Oficina' })
  @ApiOperation({ summary: 'Envia o logo da oficina (usado no PDF; só MASTER)' })
  logo(@AtorAtual() ator: AtorUsuario, @UploadedFile() arquivo: Express.Multer.File | undefined) {
    return this.oficinas.definirLogo(ator, arquivo);
  }

  @Put('configuracoes/descontos')
  @ExigeRole('MASTER')
  @Auditar({ acao: 'CONFIG_DESCONTOS_ALTERADA' })
  @ApiOperation({ summary: 'Parâmetros de desconto (só MASTER)' })
  descontos(@AtorAtual() ator: AtorUsuario, @Body() dto: ConfigDescontosDto) {
    return this.oficinas.configurarDescontos(ator.oficinaId, dto);
  }

  @Put('configuracoes/agendamento')
  @ExigeRole('MASTER')
  @Auditar({ acao: 'CONFIG_AGENDAMENTO_ALTERADA' })
  @ApiOperation({ summary: 'Antecedência mínima para o cliente reagendar/cancelar (só MASTER)' })
  agendamento(@AtorAtual() ator: AtorUsuario, @Body() dto: ConfigAgendamentoDto) {
    return this.oficinas.configurarAgendamento(ator.oficinaId, dto);
  }

  @Get('horarios')
  @ApiOperation({ summary: 'Horário de funcionamento (dias abertos)' })
  horarios() {
    return this.oficinas.horarios();
  }

  @Put('horarios')
  @ExigeRole('MASTER')
  @Auditar({ acao: 'HORARIOS_ALTERADOS' })
  @ApiOperation({
    summary: 'Define a semana inteira; dias fora da lista ficam fechados (só MASTER)',
  })
  definirHorarios(@Body() dto: HorariosDto) {
    return this.oficinas.definirHorarios(dto.dias);
  }
}
