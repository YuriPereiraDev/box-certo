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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores, ExigePermissaoPlataforma } from '../common/auth/decorators.js';
import type { AtorPlataforma } from '../common/contexto/contexto.js';
import { AdminsService } from './admins.service.js';
import { AtualizarAdminDto, CriarAdminDto, StatusContaDto } from './plataforma.dto.js';

const ID = new ParseUUIDPipe();

@ApiTags('Plataforma — Admins')
@ApiBearerAuth()
@Controller('plataforma/admins')
@Atores('PLATAFORMA')
@ExigePermissaoPlataforma('GESTAO_ADMINS')
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os admins da plataforma (GESTAO_ADMINS)' })
  listar() {
    return this.admins.listar();
  }

  @Post()
  @Auditar({ acao: 'ADMIN_CRIADO', entidade: 'PlatformAdmin' })
  @ApiOperation({
    summary: 'Cria admin com senha temporária (mostrada uma vez)',
    description: 'Só concede permissões que você tem. O 2FA é configurado no primeiro login.',
  })
  criar(@AtorAtual() a: AtorPlataforma, @Body() dto: CriarAdminDto) {
    return this.admins.criar(a, dto);
  }

  @Patch(':id')
  @Auditar({ acao: 'ADMIN_ATUALIZADO', entidade: 'PlatformAdmin' })
  @ApiOperation({ summary: 'Altera nome e permissões (não vale para o dono nem para si mesmo)' })
  atualizar(
    @AtorAtual() a: AtorPlataforma,
    @Param('id', ID) id: string,
    @Body() dto: AtualizarAdminDto,
  ) {
    return this.admins.atualizar(a, id, dto);
  }

  @Patch(':id/status')
  @Auditar({ acao: 'ADMIN_STATUS_ALTERADO', entidade: 'PlatformAdmin' })
  @ApiOperation({ summary: 'Bloqueia ou libera admin (bloquear encerra as sessões)' })
  status(@AtorAtual() a: AtorPlataforma, @Param('id', ID) id: string, @Body() dto: StatusContaDto) {
    return this.admins.definirStatus(a, id, dto.ativo);
  }

  @Post(':id/resetar-acesso')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'ADMIN_ACESSO_RESETADO', entidade: 'PlatformAdmin' })
  @ApiOperation({ summary: 'Nova senha temporária e 2FA zerado' })
  resetar(@AtorAtual() a: AtorPlataforma, @Param('id', ID) id: string) {
    return this.admins.resetarAcesso(a, id);
  }
}
