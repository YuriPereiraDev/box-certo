import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { UserRole } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Perfis que contam no limite de mecânicos do plano (o master também atende). */
export const ROLES_QUE_CONTAM = ['MASTER', 'MECANICO'] as const satisfies readonly UserRole[];

export function contaNoLimite(role: UserRole): boolean {
  return (ROLES_QUE_CONTAM as readonly UserRole[]).includes(role);
}

@Injectable()
export class PlanoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lança 422 se adicionar `novos` mecânicos ativos ultrapassar o limite do plano. */
  async garantirVagaDeMecanico(oficinaId: string, novos = 1): Promise<void> {
    const oficina = await this.prisma.oficina.findUniqueOrThrow({
      where: { id: oficinaId },
      select: { plano: { select: { nome: true, maxMecanicos: true } } },
    });
    const limite = oficina.plano.maxMecanicos;
    if (limite === null) return;

    const ativos = await this.prisma.user.count({
      where: { oficinaId, ativo: true, role: { in: [...ROLES_QUE_CONTAM] } },
    });
    if (ativos + novos > limite) {
      throw new UnprocessableEntityException({
        codigo: 'LIMITE_DO_PLANO',
        mensagem: `O plano ${oficina.plano.nome} permite até ${limite} mecânico(s) ativo(s), contando o master. Troque de plano ou desative alguém.`,
        limite,
        ativos,
      });
    }
  }
}
