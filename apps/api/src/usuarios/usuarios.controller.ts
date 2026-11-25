import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { Atores, ExigePermissao, ExigeRole } from '../common/auth/decorators.js';
import { AtualizarUsuarioDto } from './usuarios.dto.js';
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

  @Patch(':id')
  @ExigeRole('MASTER')
  @Auditar({ acao: 'USUARIO_ATUALIZADO' })
  @ApiOperation({ summary: 'Atualiza dados básicos de um usuário (só MASTER)' })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarUsuarioDto) {
    return this.usuarios.atualizar(id, dto);
  }
}
