import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  PermissaoOficina,
  PermissaoPlataforma,
  UserRole,
} from '../../generated/prisma/client.js';

export interface AtorPlataforma {
  tipo: 'PLATAFORMA';
  id: string;
  nome: string;
  email: string;
  isOwner: boolean;
  permissoes: PermissaoPlataforma[];
}

export interface AtorUsuario {
  tipo: 'USUARIO';
  id: string;
  nome: string;
  email: string;
  oficinaId: string;
  role: UserRole;
  permissoes: PermissaoOficina[];
}

export interface AtorCliente {
  tipo: 'CLIENTE';
  id: string;
  nome: string;
  email: string;
}

/** Quem está fazendo a requisição. (Modo suporte — `SUPORTE` — entra na fase 8.) */
export type Ator = AtorPlataforma | AtorUsuario | AtorCliente;
export type TipoAtorAutenticado = Ator['tipo'];

/** Alteração capturada pela extensão de auditoria do Prisma. */
export interface AlteracaoAuditada {
  entidade: string;
  operacao: string;
  entidadeId: string | null;
  oficinaId: string | null;
  antes: unknown;
  depois: unknown;
}

export interface ContextoRequisicao {
  ator?: Ator;
  ip?: string;
  userAgent?: string;
  origem?: string;
  alteracoes: AlteracaoAuditada[];
}

/** Contexto por requisição (AsyncLocalStorage), preenchido pelo middleware e pelo AuthGuard. */
export const contextoRequisicao = new AsyncLocalStorage<ContextoRequisicao>();

export function contextoAtual(): ContextoRequisicao | undefined {
  return contextoRequisicao.getStore();
}

/** oficinaId do usuário autenticado — sempre do token, nunca do corpo da requisição. */
export function oficinaIdAtual(): string | undefined {
  const ator = contextoAtual()?.ator;
  return ator?.tipo === 'USUARIO' ? ator.oficinaId : undefined;
}

/** oficinaId do token; lança se não houver (uso dentro de rotas da oficina). */
export function exigirOficinaId(): string {
  const oficinaId = oficinaIdAtual();
  if (!oficinaId) throw new Error('Rota da oficina sem oficina no contexto');
  return oficinaId;
}
