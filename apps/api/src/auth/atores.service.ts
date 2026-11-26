import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Ator, AtorUsuario, TipoAtorAutenticado } from '../common/contexto/contexto.js';
import { PermissaoOficina } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const MENSAGEM_OFICINA_BLOQUEADA = {
  SUSPENSA:
    'O acesso desta oficina está suspenso. Fale com o responsável pela oficina ou com o suporte Box Certo.',
  CANCELADA:
    'A assinatura desta oficina foi cancelada. Os dados continuam guardados; fale com o suporte Box Certo para reativar.',
} as const;

/** Carrega o ator (admin, usuário da oficina ou cliente) e verifica se ele pode entrar. */
@Injectable()
export class AtoresService {
  constructor(private readonly prisma: PrismaService) {}

  async carregar(tipo: TipoAtorAutenticado, id: string, sessaoId?: string): Promise<Ator> {
    switch (tipo) {
      case 'SUPORTE':
        return this.carregarSuporte(id, sessaoId);
      case 'PLATAFORMA': {
        const admin = await this.prisma.platformAdmin.findUnique({ where: { id } });
        if (!admin?.ativo) throw new UnauthorizedException('Conta inativa ou inexistente');
        return {
          tipo,
          id: admin.id,
          nome: admin.nome,
          email: admin.email,
          isOwner: admin.isOwner,
          permissoes: admin.permissoes,
        };
      }
      case 'USUARIO': {
        const user = await this.prisma.user.findUnique({
          where: { id },
          include: { oficina: { select: { status: true, deletedAt: true } } },
        });
        if (!user?.ativo || user.oficina.deletedAt) {
          throw new UnauthorizedException('Conta inativa ou inexistente');
        }
        this.verificarStatusOficina(user.oficina.status);
        return {
          tipo,
          id: user.id,
          nome: user.nome,
          email: user.email,
          oficinaId: user.oficinaId,
          role: user.role,
          permissoes: user.permissoes,
        };
      }
      case 'CLIENTE': {
        const cliente = await this.prisma.cliente.findUnique({ where: { id } });
        if (!cliente?.ativo) throw new UnauthorizedException('Conta inativa ou inexistente');
        return { tipo, id: cliente.id, nome: cliente.nome, email: cliente.email };
      }
    }
  }

  /**
   * Modo suporte: a sessão precisa estar aberta e no prazo, e o admin ativo com SUPORTE
   * (ou dono). Vale mesmo com a oficina suspensa — o suporte precisa entrar para ajudar.
   */
  private async carregarSuporte(adminId: string, sessaoId?: string): Promise<AtorUsuario> {
    const sessao = sessaoId
      ? await this.prisma.sessaoSuporte.findUnique({ where: { id: sessaoId } })
      : null;
    if (
      !sessao ||
      sessao.adminId !== adminId ||
      sessao.encerradaEm ||
      sessao.expiraEm <= new Date()
    ) {
      throw new UnauthorizedException('Sessão de suporte encerrada ou expirada');
    }
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin?.ativo || !(admin.isOwner || admin.permissoes.includes('SUPORTE'))) {
      throw new UnauthorizedException('Sessão de suporte inválida');
    }
    const oficina = await this.prisma.oficina.findUnique({
      where: { id: sessao.oficinaId },
      select: { deletedAt: true },
    });
    if (!oficina || oficina.deletedAt) throw new UnauthorizedException('Oficina inexistente');
    return {
      tipo: 'SUPORTE',
      id: admin.id,
      nome: `Suporte Box Certo (${admin.nome})`,
      email: admin.email,
      oficinaId: sessao.oficinaId,
      role: 'MASTER',
      permissoes: Object.values(PermissaoOficina),
      suporte: { adminId: admin.id, sessaoId: sessao.id, expiraEm: sessao.expiraEm },
    };
  }

  /** Oficina suspensa ou cancelada: 403 com mensagem clara (os dados são mantidos). */
  verificarStatusOficina(status: string): void {
    if (status === 'SUSPENSA' || status === 'CANCELADA') {
      throw new ForbiddenException({
        codigo: `OFICINA_${status}`,
        mensagem: MENSAGEM_OFICINA_BLOQUEADA[status],
      });
    }
  }
}
