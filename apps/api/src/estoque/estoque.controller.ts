import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores, ExigePermissao } from '../common/auth/decorators.js';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import {
  AjusteEstoqueDto,
  AtualizarPecaDto,
  CriarPecaDto,
  EntradaEstoqueDto,
  FiltroEstoqueDto,
  FiltroMovimentosDto,
} from './estoque.dto.js';
import { EstoqueService } from './estoque.service.js';

const ID = new ParseUUIDPipe();

@ApiTags('Oficina — Estoque')
@ApiBearerAuth()
@Controller('oficina/estoque')
@Atores('USUARIO')
export class EstoqueController {
  constructor(private readonly estoque: EstoqueService) {}

  @Get()
  @ApiOperation({
    summary: 'Peças do estoque (todos consultam; custo só MASTER/FINANCEIRO)',
    description: 'Cada peça traz `disponivel` (quantidade − reservada) e `abaixoDoMinimo`.',
  })
  listar(@AtorAtual() a: AtorUsuario, @Query() f: FiltroEstoqueDto) {
    return this.estoque.listar(a, f);
  }

  @Get('alertas')
  @ApiOperation({ summary: 'Peças no estoque mínimo ou abaixo' })
  alertas(@AtorAtual() a: AtorUsuario) {
    return this.estoque.alertas(a);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha uma peça' })
  detalhar(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string) {
    return this.estoque.detalhar(a, id);
  }

  @Get(':id/movimentos')
  @ApiOperation({ summary: 'Movimentos da peça (entradas, reservas, saídas, ajustes)' })
  movimentos(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Query() f: FiltroMovimentosDto,
  ) {
    return this.estoque.movimentos(a, id, f);
  }

  @Post()
  @ExigePermissao('GERIR_ESTOQUE')
  @Auditar({ acao: 'ESTOQUE_PECA_CADASTRADA', entidade: 'EstoqueItem' })
  @ApiOperation({ summary: 'Cadastra peça (MASTER ou GERIR_ESTOQUE)' })
  criar(@AtorAtual() a: AtorUsuario, @Body() dto: CriarPecaDto) {
    return this.estoque.criar(a, dto);
  }

  @Patch(':id')
  @ExigePermissao('GERIR_ESTOQUE')
  @Auditar({ acao: 'ESTOQUE_PECA_ATUALIZADA', entidade: 'EstoqueItem' })
  @ApiOperation({ summary: 'Atualiza dados da peça (a quantidade muda por entrada ou ajuste)' })
  atualizar(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Body() dto: AtualizarPecaDto,
  ) {
    return this.estoque.atualizar(a, id, dto);
  }

  @Delete(':id')
  @ExigePermissao('GERIR_ESTOQUE')
  @Auditar({ acao: 'ESTOQUE_PECA_DESATIVADA', entidade: 'EstoqueItem' })
  @ApiOperation({ summary: 'Desativa a peça (exclusão lógica; não pode ter reserva)' })
  desativar(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string) {
    return this.estoque.desativar(a, id);
  }

  @Post(':id/entradas')
  @ExigePermissao('GERIR_ESTOQUE')
  @Auditar({ acao: 'ESTOQUE_ENTRADA', entidade: 'MovimentoEstoque' })
  @ApiOperation({
    summary: 'Entrada de compra (custo médio ponderado; gera despesa por padrão)',
    description:
      '`gerarDespesa` (padrão true) cria a despesa na categoria Peças, "a pagar" salvo `despesaPaga`.',
  })
  entrada(
    @AtorAtual() a: AtorUsuario,
    @Param('id', ID) id: string,
    @Body() dto: EntradaEstoqueDto,
  ) {
    return this.estoque.entrada(a, id, dto);
  }

  @Post(':id/ajustes')
  @ExigePermissao('GERIR_ESTOQUE')
  @Auditar({ acao: 'ESTOQUE_AJUSTE', entidade: 'MovimentoEstoque' })
  @ApiOperation({ summary: 'Ajuste manual pela contagem (motivo obrigatório)' })
  ajustar(@AtorAtual() a: AtorUsuario, @Param('id', ID) id: string, @Body() dto: AjusteEstoqueDto) {
    return this.estoque.ajustar(a, id, dto);
  }
}
