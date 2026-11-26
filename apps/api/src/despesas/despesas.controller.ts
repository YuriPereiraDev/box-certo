import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DocUpload, uploadImagem } from '../arquivos/upload.decorators.js';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores, ExigePermissao } from '../common/auth/decorators.js';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import {
  AtualizarCategoriaDto,
  AtualizarDespesaDto,
  AtualizarRecorrenteDto,
  CategoriaDto,
  CriarDespesaDto,
  ExcluirDespesaDto,
  FiltroAVencerDto,
  FiltroDespesasDto,
  FiltroPeriodoDto,
  PagarDespesaDto,
  RecorrenteDto,
} from './despesas.dto.js';
import { DespesasService } from './despesas.service.js';
import { RecorrentesService } from './recorrentes.service.js';

const ID = new ParseUUIDPipe();

/**
 * Despesas: MASTER ou permissão FINANCEIRO em todas as rotas (mecânico comum: 403).
 * Salários exigem também VER_SALARIOS (sem ela, somem de listas e totais).
 * Estes controllers com rotas fixas são registrados antes do de `:id`.
 */
@ApiTags('Oficina — Despesas')
@ApiBearerAuth()
@Controller('oficina/despesas/categorias')
@Atores('USUARIO')
@ExigePermissao('FINANCEIRO')
export class CategoriasDespesaController {
  constructor(private readonly despesas: DespesasService) {}

  @Get()
  @ApiOperation({ summary: 'Categorias de despesa (as de salário só com VER_SALARIOS)' })
  listar(@AtorAtual() a: AtorUsuario) {
    return this.despesas.listarCategorias(a);
  }

  @Post()
  @Auditar({ acao: 'DESPESA_CATEGORIA_CRIADA', entidade: 'CategoriaDespesa' })
  @ApiOperation({ summary: 'Cria categoria' })
  criar(@AtorAtual() a: AtorUsuario, @Body() dto: CategoriaDto) {
    return this.despesas.criarCategoria(a, dto);
  }

  @Patch(':id')
  @Auditar({ acao: 'DESPESA_CATEGORIA_ATUALIZADA', entidade: 'CategoriaDespesa' })
  @ApiOperation({ summary: 'Renomeia ou desativa categoria (padrão não muda)' })
  atualizar(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Body() dto: AtualizarCategoriaDto,
  ) {
    return this.despesas.atualizarCategoria(a, id, dto);
  }
}

@ApiTags('Oficina — Despesas')
@ApiBearerAuth()
@Controller('oficina/despesas/recorrentes')
@Atores('USUARIO')
@ExigePermissao('FINANCEIRO')
export class RecorrentesController {
  constructor(private readonly recorrentes: RecorrentesService) {}

  @Get()
  @ApiOperation({ summary: 'Despesas recorrentes' })
  listar(@AtorAtual() a: AtorUsuario) {
    return this.recorrentes.listar(a);
  }

  @Post()
  @Auditar({ acao: 'DESPESA_RECORRENTE_CRIADA', entidade: 'DespesaRecorrente' })
  @ApiOperation({
    summary: 'Cria despesa recorrente',
    description:
      'Gera a despesa do mês atual se o vencimento ainda não passou; as próximas no dia 1º.',
  })
  criar(@AtorAtual() a: AtorUsuario, @Body() dto: RecorrenteDto) {
    return this.recorrentes.criar(a, dto);
  }

  @Post('gerar')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'DESPESAS_RECORRENTES_GERADAS', entidade: 'Despesa' })
  @ApiOperation({ summary: 'Gera agora as despesas do mês que faltam (o job faz isso todo dia)' })
  gerar(@AtorAtual() a: AtorUsuario) {
    return this.recorrentes.gerarDoMes(a);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha recorrente' })
  detalhar(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string) {
    return this.recorrentes.buscar(a, id);
  }

  @Patch(':id')
  @Auditar({ acao: 'DESPESA_RECORRENTE_ATUALIZADA', entidade: 'DespesaRecorrente' })
  @ApiOperation({ summary: 'Atualiza (vale para as próximas despesas geradas)' })
  atualizar(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Body() dto: AtualizarRecorrenteDto,
  ) {
    return this.recorrentes.atualizar(a, id, dto);
  }

  @Delete(':id')
  @Auditar({ acao: 'DESPESA_RECORRENTE_DESATIVADA', entidade: 'DespesaRecorrente' })
  @ApiOperation({ summary: 'Desativa (exclusão lógica)' })
  desativar(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string) {
    return this.recorrentes.desativar(a, id);
  }
}

@ApiTags('Oficina — Despesas')
@ApiBearerAuth()
@Controller('oficina/despesas')
@Atores('USUARIO')
@ExigePermissao('FINANCEIRO')
export class DespesasController {
  constructor(private readonly despesas: DespesasService) {}

  @Get()
  @ApiOperation({ summary: 'Lista despesas com filtros e somas (pago / a pagar)' })
  listar(@AtorAtual() a: AtorUsuario, @Query() f: FiltroDespesasDto) {
    return this.despesas.listar(a, f);
  }

  @Get('resumo')
  @ApiOperation({
    summary: 'Totais do período por categoria e situação; vencidas e a vencer em 7 dias',
  })
  resumo(@AtorAtual() a: AtorUsuario, @Query() f: FiltroPeriodoDto) {
    return this.despesas.resumo(a, f.de, f.ate);
  }

  @Get('a-vencer')
  @ApiOperation({ summary: 'Contas a pagar que vencem nos próximos N dias (inclui vencidas)' })
  aVencer(@AtorAtual() a: AtorUsuario, @Query() f: FiltroAVencerDto) {
    return this.despesas.aVencer(a, f.dias);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha despesa com comprovantes' })
  detalhar(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string) {
    return this.despesas.detalhar(a, id);
  }

  @Post()
  @Auditar({ acao: 'DESPESA_LANCADA', entidade: 'Despesa' })
  @ApiOperation({
    summary:
      'Lança despesa (pagamento de funcionário: categoria de salários + funcionário + subtipo)',
  })
  criar(@AtorAtual() a: AtorUsuario, @Body() dto: CriarDespesaDto) {
    return this.despesas.criar(a, dto);
  }

  @Patch(':id')
  @Auditar({ acao: 'DESPESA_ALTERADA', entidade: 'Despesa' })
  @ApiOperation({ summary: 'Altera despesa' })
  atualizar(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Body() dto: AtualizarDespesaDto,
  ) {
    return this.despesas.atualizar(a, id, dto);
  }

  @Post(':id/pagar')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'DESPESA_PAGA', entidade: 'Despesa' })
  @ApiOperation({ summary: 'Marca como paga' })
  pagar(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string, @Body() dto: PagarDespesaDto) {
    return this.despesas.pagar(a, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditar({ acao: 'DESPESA_EXCLUIDA', entidade: 'Despesa' })
  @ApiOperation({ summary: 'Exclui (lógica; motivo obrigatório)' })
  async excluir(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Body() dto: ExcluirDespesaDto,
  ) {
    await this.despesas.excluir(a, id, dto.motivo);
  }

  @Post(':id/comprovantes')
  @uploadImagem()
  @DocUpload()
  @Auditar({ acao: 'DESPESA_COMPROVANTE_ANEXADO', entidade: 'Arquivo' })
  @ApiOperation({ summary: 'Anexa comprovante (PDF ou imagem, até 10 MB; até 5)' })
  comprovante(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
  ) {
    return this.despesas.adicionarComprovante(a, id, arquivo);
  }

  @Delete(':id/comprovantes/:arquivoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditar({ acao: 'DESPESA_COMPROVANTE_REMOVIDO', entidade: 'Arquivo' })
  @ApiOperation({ summary: 'Remove comprovante (exclusão lógica)' })
  async removerComprovante(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Param('arquivoId', ID) arquivoId: string,
  ) {
    await this.despesas.removerComprovante(a, id, arquivoId);
  }
}
