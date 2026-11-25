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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores, ExigePermissao, ExigeRole } from '../common/auth/decorators.js';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import {
  AtualizarUsuarioDto,
  CriarUsuarioDto,
  PermissoesUsuarioDto,
  RedefinirSenhaDto,
  StatusUsuarioDto,
} from './usuarios.dto.js';
import { UsuariosService } from './usuarios.service.js';

@ApiTags('Oficina — Usuários')
@ApiBearerAuth()
@Controller('oficina/usuarios')
@Atores('USUARIO')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  @ExigePermissao('GERENTE')
  @ApiOperation({ summary: 'Lista os usuários da oficina (MASTER ou GERENTE)' })
  listar() {
    return this.usuarios.listar();
  }

  @Get(':id')
  @ExigePermissao('GERENTE')
  @ApiOperation({ summary: 'Detalha um usuário da oficina (MASTER ou GERENTE)' })
  detalhar(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuarios.detalhar(id);
  }

  @Post()
  @ExigeRole('MASTER')
  @Auditar({ acao: 'USUARIO_CRIADO' })
  @ApiOperation({
    summary: 'Cria mecânico ou financeiro (só MASTER)',
    description:
      'Respeita o limite de mecânicos do plano (master + mecânicos ativos). 422 LIMITE_DO_PLANO.',
  })
  criar(@Body() dto: CriarUsuarioDto) {
    return this.usuarios.criar(dto);
  }

  @Patch(':id')
  @ExigeRole('MASTER')
  @Auditar({ acao: 'USUARIO_ATUALIZADO' })
  @ApiOperation({ summary: 'Atualiza nome, telefone ou perfil (só MASTER)' })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarUsuarioDto) {
    return this.usuarios.atualizar(id, dto);
  }

  @Put(':id/permissoes')
  @ExigeRole('MASTER')
  @Auditar({ acao: 'USUARIO_PERMISSOES_ALTERADAS' })
  @ApiOperation({ summary: 'Define as permissões extras do usuário (só MASTER)' })
  permissoes(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PermissoesUsuarioDto) {
    return this.usuarios.definirPermissoes(id, dto.permissoes);
  }

  @Patch(':id/status')
  @ExigeRole('MASTER')
  @Auditar({ acao: 'USUARIO_STATUS_ALTERADO' })
  @ApiOperation({
    summary: 'Ativa ou desativa o usuário (só MASTER). Desativar encerra as sessões.',
  })
  status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusUsuarioDto,
    @AtorAtual() ator: AtorUsuario,
  ) {
    return this.usuarios.definirStatus(id, dto.ativo, ator.id);
  }

  @Post(':id/senha')
  @ExigeRole('MASTER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditar({ acao: 'USUARIO_SENHA_REDEFINIDA' })
  @ApiOperation({
    summary: 'Define nova senha para o usuário e encerra as sessões dele (só MASTER)',
  })
  async senha(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RedefinirSenhaDto) {
    await this.usuarios.redefinirSenha(id, dto.novaSenha);
  }
}
