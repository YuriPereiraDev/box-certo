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
import { Atores, ExigePermissao } from '../common/auth/decorators.js';
import {
  AtualizarItemTabelaDto,
  CriarItemTabelaDto,
  FiltroTabelaDto,
} from './tabela-precos.dto.js';
import { TabelaPrecosService } from './tabela-precos.service.js';

@ApiTags('Oficina — Tabela de preços')
@ApiBearerAuth()
@Controller('oficina/tabela-precos')
@Atores('USUARIO')
export class TabelaPrecosController {
  constructor(private readonly tabela: TabelaPrecosService) {}

  @Get()
  @ApiOperation({ summary: 'Lista a tabela de preços (todos os usuários da oficina)' })
  listar(@Query() filtro: FiltroTabelaDto) {
    return this.tabela.listar(filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um item da tabela' })
  detalhar(@Param('id', ParseUUIDPipe) id: string) {
    return this.tabela.detalhar(id);
  }

  @Post()
  @ExigePermissao('GERENTE')
  @Auditar({ acao: 'TABELA_PRECO_ITEM_CRIADO' })
  @ApiOperation({ summary: 'Cria item (MASTER ou GERENTE)' })
  criar(@Body() dto: CriarItemTabelaDto) {
    return this.tabela.criar(dto);
  }

  @Patch(':id')
  @ExigePermissao('GERENTE')
  @Auditar({ acao: 'TABELA_PRECO_ITEM_ATUALIZADO' })
  @ApiOperation({ summary: 'Atualiza item (MASTER ou GERENTE)' })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarItemTabelaDto) {
    return this.tabela.atualizar(id, dto);
  }

  @Delete(':id')
  @ExigePermissao('GERENTE')
  @Auditar({ acao: 'TABELA_PRECO_ITEM_DESATIVADO' })
  @ApiOperation({ summary: 'Desativa item — exclusão lógica (MASTER ou GERENTE)' })
  desativar(@Param('id', ParseUUIDPipe) id: string) {
    return this.tabela.desativar(id);
  }
}
