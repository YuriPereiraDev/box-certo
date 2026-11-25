import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AtorAtual, Atores } from '../common/auth/decorators.js';
import type { AtorCliente } from '../common/contexto/contexto.js';
import { BancoService } from '../prisma/banco.service.js';

@ApiTags('Cliente')
@ApiBearerAuth()
@Controller('cliente/oficinas')
@Atores('CLIENTE')
export class ClienteOficinasController {
  constructor(private readonly banco: BancoService) {}

  @Get()
  @ApiOperation({ summary: 'Oficinas às quais o cliente está vinculado' })
  async listar(@AtorAtual() ator: AtorCliente) {
    const vinculos = await this.banco.sistema.clienteOficina.findMany({
      where: { clienteId: ator.id, oficina: { deletedAt: null } },
      select: {
        createdAt: true,
        oficina: {
          select: { id: true, nome: true, telefone: true, email: true, cidade: true, uf: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return vinculos.map((v) => ({ ...v.oficina, vinculadoEm: v.createdAt }));
  }
}
