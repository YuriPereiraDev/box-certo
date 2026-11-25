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
  Put,
  Query,
  StreamableFile,
  UploadedFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { DocUpload, uploadImagem } from '../arquivos/upload.decorators.js';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores } from '../common/auth/decorators.js';
import type { AtorCliente, AtorUsuario } from '../common/contexto/contexto.js';
import {
  AbrirOsDto,
  AtualizarItemDto,
  CancelarOsClienteDto,
  CancelarOsDto,
  ConcluirOsDto,
  DadosVerificacaoDto,
  DecisaoDescontoDto,
  DescontoDto,
  FiltroOsDto,
  ItemOrcamentoDto,
  PagamentoDto,
  RespostasDto,
  TrocarMecanicoDto,
} from './ordens-servico.dto.js';
import { OrdensServicoClienteService } from './ordens-servico-cliente.service.js';
import { OrdensServicoService } from './ordens-servico.service.js';
import { PdfService } from './pdf.service.js';

const OS = 'OrdemServico';
const ITEM = 'ItemOrcamento';
const ID = new ParseUUIDPipe();

const pdf = (buffer: Buffer, numero: number) =>
  new StreamableFile(buffer, {
    type: 'application/pdf',
    disposition: `inline; filename="orcamento-${numero}.pdf"`,
  });

@ApiTags('Oficina — Ordens de serviço')
@ApiBearerAuth()
@Controller('oficina/ordens-servico')
@Atores('USUARIO')
export class OrdensServicoController {
  constructor(
    private readonly os: OrdensServicoService,
    private readonly pdf: PdfService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista OS (mecânico sem GERENTE vê só as próprias)' })
  listar(@AtorAtual() a: AtorUsuario, @Query() f: FiltroOsDto) {
    return this.os.listar(a, f);
  }

  @Post()
  @Auditar({ acao: 'OS_ABERTA', entidade: OS })
  @ApiOperation({ summary: 'Abre OS a partir de um agendamento ou no balcão' })
  abrir(@AtorAtual() a: AtorUsuario, @Body() dto: AbrirOsDto) {
    return this.os.abrir(a, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha a OS com itens, totais e fotos (custo só MASTER/FINANCEIRO)' })
  detalhar(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string) {
    return this.os.detalhar(a, id);
  }

  @Get(':id/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF do orçamento' })
  async gerarPdf(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string) {
    const os = await this.os.carregar(a, id);
    return pdf(await this.pdf.orcamento(os), os.numero);
  }

  @Patch(':id')
  @Auditar({ acao: 'OS_DADOS_ATUALIZADOS', entidade: OS })
  @ApiOperation({ summary: 'Km, combustível, estado, diagnóstico e observações (todos opcionais)' })
  dados(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Body() dto: DadosVerificacaoDto,
  ) {
    return this.os.atualizarDados(a, id, dto);
  }

  @Patch(':id/mecanico')
  @Auditar({ acao: 'OS_MECANICO_TROCADO', entidade: OS })
  @ApiOperation({ summary: 'Troca o mecânico responsável (MASTER ou GERENTE)' })
  mecanico(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Body() dto: TrocarMecanicoDto,
  ) {
    return this.os.trocarMecanico(a, id, dto.mecanicoId);
  }

  // ------------------------------------------------------------------ itens

  @Post(':id/itens')
  @Auditar({ acao: 'OS_ITEM_ADICIONADO', entidade: ITEM })
  @ApiOperation({
    summary: 'Adiciona item (da tabela ou manual)',
    description:
      'Depois do envio, qualquer alteração zera as respostas do cliente e exige reenvio.',
  })
  addItem(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string, @Body() dto: ItemOrcamentoDto) {
    return this.os.adicionarItem(a, id, dto);
  }

  @Patch(':id/itens/:itemId')
  @Auditar({ acao: 'OS_ITEM_ALTERADO', entidade: ITEM })
  @ApiOperation({ summary: 'Altera item' })
  editItem(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Param('itemId', ID) itemId: string,
    @Body() dto: AtualizarItemDto,
  ) {
    return this.os.atualizarItem(a, id, itemId, dto);
  }

  @Delete(':id/itens/:itemId')
  @Auditar({ acao: 'OS_ITEM_REMOVIDO', entidade: ITEM })
  @ApiOperation({ summary: 'Remove item (exclusão lógica)' })
  delItem(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Param('itemId', ID) itemId: string,
  ) {
    return this.os.removerItem(a, id, itemId);
  }

  @Post(':id/itens/:itemId/peca-do-cliente')
  @Auditar({ acao: 'OS_PECA_DO_CLIENTE_ADICIONADA', entidade: ITEM })
  @ApiOperation({ summary: 'Põe "peça trazida pelo cliente" no lugar de uma peça recusada' })
  pecaDoCliente(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Param('itemId', ID) itemId: string,
  ) {
    return this.os.substituirPorPecaDoCliente(a, id, itemId);
  }

  // ------------------------------------------------------------------ fluxo

  @Post(':id/enviar')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'OS_ORCAMENTO_ENVIADO', entidade: OS })
  @ApiOperation({ summary: 'Envia o orçamento ao cliente (status ORCAMENTO_ENVIADO)' })
  enviar(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string) {
    return this.os.enviar(a, id);
  }

  @Post(':id/iniciar')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'OS_EXECUCAO_INICIADA', entidade: OS })
  @ApiOperation({ summary: 'Inicia a execução (depois da aprovação)' })
  iniciar(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string) {
    return this.os.iniciarExecucao(a, id);
  }

  @Post(':id/concluir')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'OS_CONCLUIDA', entidade: OS })
  @ApiOperation({ summary: 'Conclui a OS (e o agendamento ligado a ela)' })
  concluir(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string, @Body() dto: ConcluirOsDto) {
    return this.os.concluir(a, id, dto.formaPagamento);
  }

  @Post(':id/pagamento')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'OS_PAGAMENTO_REGISTRADO', entidade: OS })
  @ApiOperation({ summary: 'Registra pagamento recebido na oficina (pagamento online: em breve)' })
  pagamento(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string, @Body() dto: PagamentoDto) {
    return this.os.registrarPagamento(a, id, dto.formaPagamento);
  }

  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'OS_CANCELADA_PELA_OFICINA', entidade: OS })
  @ApiOperation({ summary: 'Cancela a OS (mecânico da OS, gerente ou master; motivo obrigatório)' })
  cancelar(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string, @Body() dto: CancelarOsDto) {
    return this.os.cancelar(a, id, dto.motivo);
  }

  // ------------------------------------------------------------------ descontos

  @Put(':id/desconto')
  @Auditar({ acao: 'OS_DESCONTO_SOLICITADO', entidade: OS })
  @ApiOperation({
    summary: 'Desconto no total da OS',
    description:
      'Mecânico: aplica dentro do limite; acima ou sem permissão fica PENDENTE_APROVACAO.',
  })
  descontoOs(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string, @Body() dto: DescontoDto) {
    return this.os.darDescontoOs(a, id, dto);
  }

  @Post(':id/desconto/decisao')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'OS_DESCONTO_DECIDIDO', entidade: OS })
  @ApiOperation({ summary: 'Aprova ou recusa o desconto pendente do total (MASTER/GERENTE)' })
  decidirOs(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Body() dto: DecisaoDescontoDto,
  ) {
    return this.os.decidirDesconto(a, id, null, dto.aprovar);
  }

  @Delete(':id/desconto')
  @Auditar({ acao: 'OS_DESCONTO_REMOVIDO', entidade: OS })
  @ApiOperation({ summary: 'Remove o desconto do total' })
  removerOs(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string) {
    return this.os.removerDesconto(a, id, null);
  }

  @Put(':id/itens/:itemId/desconto')
  @Auditar({ acao: 'OS_ITEM_DESCONTO_SOLICITADO', entidade: ITEM })
  @ApiOperation({ summary: 'Desconto em um item' })
  descontoItem(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Param('itemId', ID) itemId: string,
    @Body() dto: DescontoDto,
  ) {
    return this.os.darDescontoItem(a, id, itemId, dto);
  }

  @Post(':id/itens/:itemId/desconto/decisao')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'OS_ITEM_DESCONTO_DECIDIDO', entidade: ITEM })
  @ApiOperation({ summary: 'Aprova ou recusa o desconto pendente do item (MASTER/GERENTE)' })
  decidirItem(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Param('itemId', ID) itemId: string,
    @Body() dto: DecisaoDescontoDto,
  ) {
    return this.os.decidirDesconto(a, id, itemId, dto.aprovar);
  }

  @Delete(':id/itens/:itemId/desconto')
  @Auditar({ acao: 'OS_ITEM_DESCONTO_REMOVIDO', entidade: ITEM })
  @ApiOperation({ summary: 'Remove o desconto do item' })
  removerItemDesc(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Param('itemId', ID) itemId: string,
  ) {
    return this.os.removerDesconto(a, id, itemId);
  }

  // ------------------------------------------------------------------ fotos

  @Post(':id/fotos')
  @uploadImagem()
  @DocUpload()
  @Auditar({ acao: 'OS_FOTO_ADICIONADA', entidade: 'Arquivo' })
  @ApiOperation({ summary: 'Anexa foto do diagnóstico (JPG, PNG, WEBP ou HEIC; até 10 MB)' })
  foto(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
  ) {
    return this.os.adicionarFoto(a, id, arquivo);
  }

  @Delete(':id/fotos/:fotoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditar({ acao: 'OS_FOTO_REMOVIDA', entidade: 'Arquivo' })
  @ApiOperation({ summary: 'Remove foto (exclusão lógica)' })
  async removerFoto(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Param('fotoId', ID) fotoId: string,
  ) {
    await this.os.removerFoto(a, id, fotoId);
  }
}

@ApiTags('Oficina — Veículos')
@ApiBearerAuth()
@Controller('oficina/veiculos')
@Atores('USUARIO')
export class HistoricoVeiculoOficinaController {
  constructor(private readonly os: OrdensServicoService) {}

  @Get(':id/historico')
  @ApiOperation({ summary: 'Histórico do veículo nesta oficina (OS e agendamentos)' })
  historico(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string) {
    return this.os.historicoVeiculo(a, id);
  }
}

@ApiTags('Cliente — Ordens de serviço')
@ApiBearerAuth()
@Controller('cliente')
@Atores('CLIENTE')
export class OrdensServicoClienteController {
  constructor(
    private readonly os: OrdensServicoClienteService,
    private readonly pdf: PdfService,
  ) {}

  @Get('ordens-servico')
  @ApiOperation({ summary: 'Minhas OS e orçamentos' })
  listar(@AtorAtual() c: AtorCliente) {
    return this.os.listar(c);
  }

  @Get('ordens-servico/:id')
  @ApiOperation({
    summary: 'Orçamento: valor original, desconto, total, link "Comprar peça" e fotos',
  })
  detalhar(@AtorAtual() c: AtorCliente, @Param('id', ID) id: string) {
    return this.os.detalhar(c, id);
  }

  @Get('ordens-servico/:id/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF do orçamento' })
  async gerarPdf(@AtorAtual() c: AtorCliente, @Param('id', ID) id: string) {
    const os = await this.os.carregar(c, id);
    return pdf(await this.pdf.orcamento(os), os.numero);
  }

  @Post('ordens-servico/:id/respostas')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'OS_ORCAMENTO_RESPONDIDO', entidade: ITEM })
  @ApiOperation({
    summary: 'Aprova ou recusa itens do orçamento',
    description:
      'Ao recusar uma peça, `vouTrazerAPeca: true` adiciona "peça trazida pelo cliente".',
  })
  responder(@AtorAtual() c: AtorCliente, @Param('id', ID) id: string, @Body() dto: RespostasDto) {
    return this.os.responder(c, id, dto.respostas);
  }

  @Post('ordens-servico/:id/cancelar')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'OS_CANCELADA_PELO_CLIENTE', entidade: OS })
  @ApiOperation({ summary: 'Cancela a OS (antes de o serviço começar)' })
  cancelar(
    @AtorAtual() c: AtorCliente,
    @Param('id', ID) id: string,
    @Body() dto: CancelarOsClienteDto,
  ) {
    return this.os.cancelar(c, id, dto.motivo);
  }

  @Get('veiculos/:id/historico')
  @ApiOperation({ summary: 'Histórico do meu veículo em todas as oficinas' })
  historico(@AtorAtual() c: AtorCliente, @Param('id', ID) id: string) {
    return this.os.historicoVeiculo(c, id);
  }
}
