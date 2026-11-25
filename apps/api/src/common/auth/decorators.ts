import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type {
  PermissaoOficina,
  PermissaoPlataforma,
  UserRole,
} from '../../generated/prisma/client.js';
import type { Ator, TipoAtorAutenticado } from '../contexto/contexto.js';

export const CHAVE_PUBLICO = 'auth:publico';
export const CHAVE_ATORES = 'auth:atores';
export const CHAVE_ROLES = 'auth:roles';
export const CHAVE_PERMISSOES_OFICINA = 'auth:permissoes-oficina';
export const CHAVE_PERMISSOES_PLATAFORMA = 'auth:permissoes-plataforma';

/** Rota sem login. */
export const Publico = () => SetMetadata(CHAVE_PUBLICO, true);

/**
 * Tipos de conta que podem usar a rota. Toda rota não pública precisa declarar isso
 * (no controller ou no método); sem declaração o acesso é negado.
 */
export const Atores = (...tipos: TipoAtorAutenticado[]) => SetMetadata(CHAVE_ATORES, tipos);

/** Usuário da oficina precisa ter um destes perfis. MASTER sempre passa. */
export const ExigeRole = (...roles: UserRole[]) => SetMetadata(CHAVE_ROLES, roles);

/** Usuário da oficina precisa ter todas estas permissões. MASTER sempre passa. */
export const ExigePermissao = (...permissoes: PermissaoOficina[]) =>
  SetMetadata(CHAVE_PERMISSOES_OFICINA, permissoes);

/** Admin da plataforma precisa ter todas estas permissões. O dono sempre passa. */
export const ExigePermissaoPlataforma = (...permissoes: PermissaoPlataforma[]) =>
  SetMetadata(CHAVE_PERMISSOES_PLATAFORMA, permissoes);

export interface RequisicaoAutenticada {
  ator?: Ator;
}

/** Injeta o ator autenticado no handler. */
export const AtorAtual = createParamDecorator((_dados: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<RequisicaoAutenticada>().ator;
});
