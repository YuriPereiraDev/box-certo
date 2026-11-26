import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores, ExigePermissaoPlataforma } from '../common/auth/decorators.js';
import type { AtorPlataforma } from '../common/contexto/contexto.js';
import { AlertasService } from './alertas.service.js';
import { AvisosService } from './avisos.service.js';
import { ContasService } from './contas.service.js';
import { DashboardPlataformaService } from './dashboard-plataforma.service.js';
import { OficinasPlataformaService } from './oficinas-plataforma.service.js';
import {
  AbrirSuporteDto,
  AtualizarAvisoDto,
  AtualizarPlanoDto,
  AvisoDto,
  BuscaContasDto,
  CriarOficinaPlataformaDto,
  EstenderTesteDto,
  FiltroAlertasDto,
  FiltroOficinasDto,
  PlanoDto,
  PrecoFundadorDto,
  StatusContaDto,
  StatusOficinaDto,
  TrocarPlanoDto,
} from './plataforma.dto.js';
import { PlanosService } from './planos.service.js';
import { SuporteService } from './suporte.service.js';

const ID = new ParseUUIDPipe();

@ApiTags('Plataforma — Dashboard')
@ApiBearerAuth()
@Controller('plataforma')
@Atores('PLATAFORMA')
export class DashboardPlataformaController {
  constructor(
    private readonly dashboard: DashboardPlataformaService,
    private readonly alertas: AlertasService,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Dashboard da plataforma',
    description: 'O bloco `financeiro` (faturamento do Box Certo, ranking) só vem com FINANCEIRO.',
  })
  montar(@AtorAtual() a: AtorPlataforma) {
    return this.dashboard.montar(a);
  }

  @Get('saude')
  @ApiOperation({ summary: 'Saúde do sistema (banco, storage, processo)' })
  saude() {
    return this.dashboard.saude();
  }

  @Get('logs/alertas')
  @ApiOperation({
    summary: 'Atividade suspeita: falhas de login, exclusões em massa, fora do horário',
  })
  alertasLogs(@Query() f: FiltroAlertasDto) {
    return this.alertas.calcular(f.horas);
  }
}

@ApiTags('Plataforma — Oficinas')
@ApiBearerAuth()
@Controller('plataforma/oficinas')
@Atores('PLATAFORMA')
export class OficinasPlataformaController {
  constructor(private readonly oficinas: OficinasPlataformaService) {}

  @Get()
  @ApiOperation({ summary: 'Lista oficinas (mensalidade e preço fundador só com FINANCEIRO)' })
  listar(@AtorAtual() a: AtorPlataforma, @Query() f: FiltroOficinasDto) {
    return this.oficinas.listar(a, f);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha oficina (faturamento só com FINANCEIRO)' })
  detalhar(@AtorAtual() a: AtorPlataforma, @Param('id', ID) id: string) {
    return this.oficinas.detalhar(a, id);
  }

  @Post()
  @ExigePermissaoPlataforma('GESTAO_OFICINAS')
  @Auditar({ acao: 'OFICINA_CRIADA_PELA_PLATAFORMA', entidade: 'Oficina' })
  @ApiOperation({ summary: 'Cria oficina em TESTE com master (senha temporária mostrada uma vez)' })
  criar(@AtorAtual() a: AtorPlataforma, @Body() dto: CriarOficinaPlataformaDto) {
    return this.oficinas.criar(a, dto);
  }

  @Patch(':id/status')
  @ExigePermissaoPlataforma('GESTAO_OFICINAS')
  @Auditar({ acao: 'OFICINA_STATUS_ALTERADO', entidade: 'Oficina' })
  @ApiOperation({ summary: 'Suspende, cancela ou reativa (ATIVA); motivo obrigatório' })
  status(
    @AtorAtual() a: AtorPlataforma,
    @Param('id', ID) id: string,
    @Body() dto: StatusOficinaDto,
  ) {
    return this.oficinas.alterarStatus(a, id, dto);
  }

  @Patch(':id/plano')
  @ExigePermissaoPlataforma('GESTAO_OFICINAS')
  @Auditar({ acao: 'OFICINA_PLANO_TROCADO', entidade: 'Oficina' })
  @ApiOperation({ summary: 'Troca o plano (respeita o limite de mecânicos ativos)' })
  plano(@AtorAtual() a: AtorPlataforma, @Param('id', ID) id: string, @Body() dto: TrocarPlanoDto) {
    return this.oficinas.trocarPlano(a, id, dto.planoId);
  }

  @Post(':id/estender-teste')
  @HttpCode(HttpStatus.OK)
  @ExigePermissaoPlataforma('GESTAO_OFICINAS')
  @Auditar({ acao: 'OFICINA_TESTE_ESTENDIDO', entidade: 'Oficina' })
  @ApiOperation({ summary: 'Estende o período de teste' })
  estender(
    @AtorAtual() a: AtorPlataforma,
    @Param('id', ID) id: string,
    @Body() dto: EstenderTesteDto,
  ) {
    return this.oficinas.estenderTeste(a, id, dto.dias);
  }

  @Put(':id/preco-fundador')
  @ExigePermissaoPlataforma('FINANCEIRO')
  @Auditar({ acao: 'OFICINA_PRECO_FUNDADOR_ALTERADO', entidade: 'Oficina' })
  @ApiOperation({ summary: 'Define ou remove o preço fundador (FINANCEIRO)' })
  precoFundador(
    @AtorAtual() a: AtorPlataforma,
    @Param('id', ID) id: string,
    @Body() dto: PrecoFundadorDto,
  ) {
    return this.oficinas.definirPrecoFundador(a, id, dto.precoFundadorCentavos);
  }

  @Get(':id/exportar')
  @ExigePermissaoPlataforma('GESTAO_OFICINAS')
  @Auditar({ acao: 'OFICINA_DADOS_EXPORTADOS', entidade: 'Oficina' })
  @ApiOperation({
    summary: 'Exporta todos os dados da oficina em JSON (LGPD; sem senhas nem segredos)',
  })
  async exportar(@Param('id', ID) id: string) {
    const dados = await this.oficinas.exportar(id);
    return new StreamableFile(Buffer.from(JSON.stringify(dados, null, 2)), {
      type: 'application/json',
      disposition: `attachment; filename="oficina-${id}.json"`,
    });
  }
}

@ApiTags('Plataforma — Planos')
@ApiBearerAuth()
@Controller('plataforma/planos')
@Atores('PLATAFORMA')
export class PlanosController {
  constructor(private readonly planos: PlanosService) {}

  @Get()
  @ApiOperation({ summary: 'Lista planos (preço só com FINANCEIRO)' })
  listar(@AtorAtual() a: AtorPlataforma) {
    return this.planos.listar(a);
  }

  @Post()
  @ExigePermissaoPlataforma('FINANCEIRO')
  @Auditar({ acao: 'PLANO_CRIADO', entidade: 'Plano' })
  @ApiOperation({ summary: 'Cria plano (FINANCEIRO)' })
  criar(@Body() dto: PlanoDto) {
    return this.planos.criar(dto);
  }

  @Patch(':id')
  @ExigePermissaoPlataforma('FINANCEIRO')
  @Auditar({ acao: 'PLANO_ALTERADO', entidade: 'Plano' })
  @ApiOperation({ summary: 'Altera plano (FINANCEIRO)' })
  atualizar(@Param('id', ID) id: string, @Body() dto: AtualizarPlanoDto) {
    return this.planos.atualizar(id, dto);
  }
}

@ApiTags('Plataforma — Contas')
@ApiBearerAuth()
@Controller('plataforma')
@Atores('PLATAFORMA')
@ExigePermissaoPlataforma('GESTAO_USUARIOS')
export class ContasController {
  constructor(private readonly contas: ContasService) {}

  @Get('contas')
  @ApiOperation({ summary: 'Busca usuários de oficinas e clientes por nome, e-mail ou CPF' })
  buscar(@Query() f: BuscaContasDto) {
    return this.contas.buscar(f.q);
  }

  @Patch('usuarios/:id/status')
  @Auditar({ acao: 'PLATAFORMA_USUARIO_STATUS_ALTERADO', entidade: 'User' })
  @ApiOperation({ summary: 'Bloqueia ou libera usuário de oficina' })
  statusUsuario(@Param('id', ID) id: string, @Body() dto: StatusContaDto) {
    return this.contas.statusUsuario(id, dto.ativo);
  }

  @Post('usuarios/:id/resetar-senha')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'PLATAFORMA_USUARIO_SENHA_RESETADA', entidade: 'User' })
  @ApiOperation({ summary: 'Gera senha temporária para usuário de oficina (mostrada uma vez)' })
  resetarUsuario(@Param('id', ID) id: string) {
    return this.contas.resetarUsuario(id);
  }

  @Patch('clientes/:id/status')
  @Auditar({ acao: 'PLATAFORMA_CLIENTE_STATUS_ALTERADO', entidade: 'Cliente' })
  @ApiOperation({ summary: 'Bloqueia ou libera cliente' })
  statusCliente(@Param('id', ID) id: string, @Body() dto: StatusContaDto) {
    return this.contas.statusCliente(id, dto.ativo);
  }

  @Post('clientes/:id/resetar-senha')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'PLATAFORMA_CLIENTE_SENHA_RESETADA', entidade: 'Cliente' })
  @ApiOperation({ summary: 'Gera senha temporária para cliente (mostrada uma vez)' })
  resetarCliente(@Param('id', ID) id: string) {
    return this.contas.resetarCliente(id);
  }
}

@ApiTags('Plataforma — Avisos e suporte')
@ApiBearerAuth()
@Controller('plataforma')
@Atores('PLATAFORMA')
@ExigePermissaoPlataforma('SUPORTE')
export class SuporteController {
  constructor(
    private readonly avisos: AvisosService,
    private readonly suporte: SuporteService,
  ) {}

  @Get('avisos')
  @ApiOperation({ summary: 'Todos os avisos globais' })
  listarAvisos() {
    return this.avisos.listar();
  }

  @Post('avisos')
  @Auditar({ acao: 'AVISO_GLOBAL_CRIADO', entidade: 'AvisoGlobal' })
  @ApiOperation({ summary: 'Publica aviso global' })
  criarAviso(@AtorAtual() a: AtorPlataforma, @Body() dto: AvisoDto) {
    return this.avisos.criar(a, dto);
  }

  @Patch('avisos/:id')
  @Auditar({ acao: 'AVISO_GLOBAL_ALTERADO', entidade: 'AvisoGlobal' })
  @ApiOperation({ summary: 'Altera ou desativa aviso' })
  atualizarAviso(@Param('id', ID) id: string, @Body() dto: AtualizarAvisoDto) {
    return this.avisos.atualizar(id, dto);
  }

  @Post('suporte/sessoes')
  @Auditar({ acao: 'SUPORTE_SESSAO_INICIADA', entidade: 'SessaoSuporte' })
  @ApiOperation({
    summary: 'Entra no modo suporte de uma oficina (token por tempo limitado)',
    description:
      'Use o `accessToken` nas rotas /oficina/*: age como MASTER e tudo fica auditado como SUPORTE.',
  })
  abrir(@AtorAtual() a: AtorPlataforma, @Body() dto: AbrirSuporteDto) {
    return this.suporte.abrir(a, dto);
  }

  @Get('suporte/sessoes')
  @ApiOperation({ summary: 'Sessões de suporte abertas agora' })
  ativas() {
    return this.suporte.ativas();
  }

  @Post('suporte/sessoes/:id/encerrar')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'SUPORTE_SESSAO_ENCERRADA', entidade: 'SessaoSuporte' })
  @ApiOperation({ summary: 'Encerra a sessão de suporte antes do prazo' })
  encerrar(@AtorAtual() a: AtorPlataforma, @Param('id', ID) id: string) {
    return this.suporte.encerrar(a, id);
  }
}

@ApiTags('Avisos')
@ApiBearerAuth()
@Controller('avisos')
@Atores('PLATAFORMA', 'USUARIO', 'CLIENTE')
export class AvisosVigentesController {
  constructor(private readonly avisos: AvisosService) {}

  @Get()
  @ApiOperation({ summary: 'Avisos globais vigentes (para exibir no app)' })
  vigentes() {
    return this.avisos.vigentes();
  }
}
