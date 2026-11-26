import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AtorPlataforma } from '../common/contexto/contexto.js';
import { Prisma } from '../generated/prisma/client.js';
import { BancoService } from '../prisma/banco.service.js';
import type { AtualizarPlanoDto, PlanoDto } from './plataforma.dto.js';
import { podeVerValores } from './regras.js';

/** Planos: qualquer admin lista (preço só com FINANCEIRO); criar/alterar exige FINANCEIRO. */
@Injectable()
export class PlanosService {
  constructor(private readonly banco: BancoService) {}

  async listar(admin: AtorPlataforma) {
    const planos = await this.banco.sistema.plano.findMany({
      include: { _count: { select: { oficinas: true } } },
      orderBy: { precoCentavos: 'asc' },
    });
    const verValores = podeVerValores(admin);
    return planos.map(({ precoCentavos, _count, ...p }) => ({
      ...p,
      oficinas: _count.oficinas,
      ...(verValores ? { precoCentavos } : {}),
    }));
  }

  async criar(dto: PlanoDto) {
    try {
      return await this.banco.sistema.plano.create({
        data: { ...dto, maxMecanicos: dto.maxMecanicos ?? null },
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new ConflictException('Já existe um plano com este nome');
      }
      throw erro;
    }
  }

  /** Mudança de preço vale para as próximas cobranças; preço fundador das oficinas não muda. */
  async atualizar(id: string, dto: AtualizarPlanoDto) {
    const existe = await this.banco.sistema.plano.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Plano não encontrado');
    return this.banco.sistema.plano.update({ where: { id }, data: dto });
  }
}
