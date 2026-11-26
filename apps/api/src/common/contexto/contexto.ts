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

/**
 * Usuário da oficina. No modo suporte (`tipo: 'SUPORTE'`) é um admin da plataforma agindo
 * na oficina como MASTER por tempo limitado: `id` é o do admin (não é um User) e tudo fica
 * auditado como SUPORTE ("Suporte Box Certo" nos logs da oficina).
 */
export interface AtorUsuario {
  tipo: 'USUARIO' | 'SUPORTE';
  id: string;
  nome: string;
  email: string;
  oficinaId: string;
  role: UserRole;
  permissoes: PermissaoOficina[];
  suporte?: { adminId: string; sessaoId: string; expiraEm: Date };
}

export interface AtorCliente {
  tipo: 'CLIENTE';
  id: string;
  nome: string;
  email: string;
}

/** Quem está fazendo a requisição. */
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
  /** Alterações já auditadas nesta requisição (o log é gravado na transação de cada uma). */
  alteracoes: AlteracaoAuditada[];
  /** Nome da ação (@Auditar) e motivo do corpo, definidos pelo interceptor antes do handler. */
  auditoria?: { acao?: string; entidade?: string; motivo?: string | null };
}

/** Contexto por requisição (AsyncLocalStorage), preenchido pelo middleware e pelo AuthGuard. */
export const contextoRequisicao = new AsyncLocalStorage<ContextoRequisicao>();

export function contextoAtual(): ContextoRequisicao | undefined {
  return contextoRequisicao.getStore();
}

/** oficinaId do usuário autenticado — sempre do token, nunca do corpo da requisição. */
export function oficinaIdAtual(): string | undefined {
  const ator = contextoAtual()?.ator;
  return ator?.tipo === 'USUARIO' || ator?.tipo === 'SUPORTE' ? ator.oficinaId : undefined;
}

/** oficinaId do token; lança se não houver (uso dentro de rotas da oficina). */
/** Ator da oficina (usuário ou suporte), ou undefined. */
export function ehAtorDaOficina(ator: Ator | undefined): ator is AtorUsuario {
  return ator?.tipo === 'USUARIO' || ator?.tipo === 'SUPORTE';
}

export function exigirOficinaId(): string {
  const oficinaId = oficinaIdAtual();
  if (!oficinaId) throw new Error('Rota da oficina sem oficina no contexto');
  return oficinaId;
}
