import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  PermissaoOficina,
  PermissaoPlataforma,
  UserRole,
} from '../../generated/prisma/client.js';
import type { Ator, TipoAtorAutenticado } from '../contexto/contexto.js';
import {
  CHAVE_ATORES,
  CHAVE_PERMISSOES_OFICINA,
  CHAVE_PERMISSOES_PLATAFORMA,
  CHAVE_PUBLICO,
  CHAVE_ROLES,
  type RequisicaoAutenticada,
} from './decorators.js';

export interface RegrasAcesso {
  atores?: TipoAtorAutenticado[];
  roles?: UserRole[];
  permissoesOficina?: PermissaoOficina[];
  permissoesPlataforma?: PermissaoPlataforma[];
}

const SEM_PERMISSAO = 'Você não tem permissão para acessar este recurso';

/** Regra de acesso pura (testável sem Nest). Lança 403 quando o ator não pode passar. */
export function verificarAcesso(ator: Ator, regras: RegrasAcesso): void {
  // Fail closed: rota autenticada sem @Atores não libera ninguém.
  if (!regras.atores?.length || !regras.atores.includes(ator.tipo)) {
    throw new ForbiddenException(SEM_PERMISSAO);
  }

  if (ator.tipo === 'USUARIO' && ator.role !== 'MASTER') {
    if (regras.roles?.length && !regras.roles.includes(ator.role)) {
      throw new ForbiddenException(SEM_PERMISSAO);
    }
    const faltando = (regras.permissoesOficina ?? []).filter((p) => !ator.permissoes.includes(p));
    if (faltando.length) throw new ForbiddenException(SEM_PERMISSAO);
  }

  if (ator.tipo === 'PLATAFORMA' && !ator.isOwner) {
    const faltando = (regras.permissoesPlataforma ?? []).filter(
      (p) => !ator.permissoes.includes(p),
    );
    if (faltando.length) throw new ForbiddenException(SEM_PERMISSAO);
  }
}

/** Guard global de autorização: tipo de conta, perfil e permissões (seção 4). */
@Injectable()
export class AcessoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const alvos = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICO, alvos)) return true;

    const { ator } = ctx.switchToHttp().getRequest<RequisicaoAutenticada>();
    if (!ator) throw new ForbiddenException(SEM_PERMISSAO);

    verificarAcesso(ator, {
      atores: this.reflector.getAllAndOverride(CHAVE_ATORES, alvos),
      roles: this.reflector.getAllAndOverride(CHAVE_ROLES, alvos),
      permissoesOficina: this.reflector.getAllAndMerge(CHAVE_PERMISSOES_OFICINA, alvos),
      permissoesPlataforma: this.reflector.getAllAndMerge(CHAVE_PERMISSOES_PLATAFORMA, alvos),
    });
    return true;
  }
}
