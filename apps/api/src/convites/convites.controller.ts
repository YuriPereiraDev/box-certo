import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Auditar, SemAuditoriaDeRequisicao } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores, Publico } from '../common/auth/decorators.js';
import { LimiteLogin } from '../common/auth/limites.js';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import { CadastroClienteDto, CriarConviteDto, VincularClienteDto } from './convites.dto.js';
import { ConvitesService } from './convites.service.js';

@ApiTags('Oficina — Convites')
@ApiBearerAuth()
@Controller('oficina/convites')
@Atores('USUARIO')
export class ConvitesController {
  constructor(private readonly convites: ConvitesService) {}

  @Post()
  @Auditar({ acao: 'CONVITE_CRIADO' })
  @ApiOperation({
    summary: 'Gera convite geral ou individual (qualquer usuário da oficina)',
    description: 'Devolve o código e o link https://<dominio>/convite/<codigo>.',
  })
  criar(@Body() dto: CriarConviteDto, @AtorAtual() ator: AtorUsuario) {
    return this.convites.criar(dto, ator);
  }

  @Get()
  @ApiOperation({ summary: 'Lista os convites da oficina com a situação de cada um' })
  listar() {
    return this.convites.listar();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um convite' })
  detalhar(@Param('id', ParseUUIDPipe) id: string) {
    return this.convites.detalhar(id);
  }

  @Get(':id/qrcode')
  @ApiProduces('image/png')
  @ApiOperation({ summary: 'QR code (PNG) do link do convite' })
  async qrcode(@Param('id', ParseUUIDPipe) id: string) {
    return new StreamableFile(await this.convites.qrCode(id), { type: 'image/png' });
  }

  @Patch(':id/desativar')
  @Auditar({ acao: 'CONVITE_DESATIVADO' })
  @ApiOperation({ summary: 'Desativa o convite (MASTER, GERENTE ou quem criou)' })
  desativar(@Param('id', ParseUUIDPipe) id: string, @AtorAtual() ator: AtorUsuario) {
    return this.convites.desativar(id, ator);
  }
}

@ApiTags('Público')
@Controller('publico/convites')
@Publico()
export class ConvitesPublicoController {
  constructor(private readonly convites: ConvitesService) {}

  @Get(':codigo')
  @ApiOperation({
    summary: 'Consulta um convite pelo código',
    description:
      '404 CONVITE_NAO_ENCONTRADO; 410 CONVITE_EXPIRADO / CONVITE_INATIVO / CONVITE_ESGOTADO.',
  })
  consultar(@Param('codigo') codigo: string) {
    return this.convites.consultar(codigo);
  }

  @Post(':codigo/cadastro')
  @LimiteLogin()
  @Auditar({ acao: 'CLIENTE_CADASTRADO_POR_CONVITE' })
  @ApiOperation({
    summary: 'Cliente novo: cria a conta e vincula à oficina do convite',
    description: '409 CLIENTE_JA_CADASTRADO quando o CPF ou e-mail já tem conta (use /vincular).',
  })
  cadastrar(@Param('codigo') codigo: string, @Body() dto: CadastroClienteDto) {
    return this.convites.cadastrar(codigo, dto);
  }

  @Post(':codigo/vincular')
  @LimiteLogin()
  @SemAuditoriaDeRequisicao()
  @Auditar({ acao: 'CLIENTE_VINCULADO_POR_CONVITE' })
  @ApiOperation({ summary: 'Cliente que já tem conta: login + vínculo com a oficina do convite' })
  vincular(@Param('codigo') codigo: string, @Body() dto: VincularClienteDto) {
    return this.convites.vincular(codigo, dto);
  }
}
