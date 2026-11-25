import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Atores, ExigePermissaoPlataforma } from '../common/auth/decorators.js';
import { BancoService } from '../prisma/banco.service.js';

/** Fase 1: só listagem (para validar permissões). Criar/editar admins entra na fase 8. */
@ApiTags('Plataforma — Admins')
@ApiBearerAuth()
@Controller('plataforma/admins')
@Atores('PLATAFORMA')
export class AdminsController {
  constructor(private readonly banco: BancoService) {}

  @Get()
  @ExigePermissaoPlataforma('GESTAO_ADMINS')
  @ApiOperation({ summary: 'Lista os admins da plataforma (GESTAO_ADMINS)' })
  listar() {
    return this.banco.sistema.platformAdmin.findMany({
      select: {
        id: true,
        nome: true,
        email: true,
        isOwner: true,
        permissoes: true,
        ativo: true,
        totpAtivadoEm: true,
        createdAt: true,
      },
      orderBy: { nome: 'asc' },
    });
  }
}
