import type { AtorUsuario } from '../common/contexto/contexto.js';

/**
 * LGPD (minimização): CPF, RG, nascimento, e-mail e endereço do cliente só para MASTER,
 * GERENTE ou permissão FINANCEIRO. O mecânico comum vê nome e telefone, o suficiente para
 * atender (decisão da revisão de segurança).
 */
export function podeVerDadosPessoais(ator: AtorUsuario): boolean {
  return (
    ator.role === 'MASTER' ||
    ator.permissoes.includes('GERENTE') ||
    ator.permissoes.includes('FINANCEIRO')
  );
}

/** Dados do cliente que qualquer usuário da oficina vê. */
export const SELECAO_CLIENTE_BASICA = {
  id: true,
  nome: true,
  telefone: true,
  createdAt: true,
} as const;
