import { randomInt } from 'node:crypto';
import type { AtorPlataforma } from '../common/contexto/contexto.js';

/**
 * Valores (faturamento do Box Certo, preços de planos, preço fundador, ranking de faturamento):
 * só o dono ou admins com FINANCEIRO (seção 4.1). Critério da fase 8.
 */
export function podeVerValores(admin: AtorPlataforma): boolean {
  return admin.isOwner || admin.permissoes.includes('FINANCEIRO');
}

/** Sem caracteres ambíguos; 12 caracteres com letras, números e símbolo. */
export function gerarSenhaTemporaria(): string {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const numeros = '23456789';
  const simbolos = '!@#$%*';
  const todos = letras + numeros + simbolos;
  const escolher = (fonte: string) => fonte[randomInt(fonte.length)];
  const base = [escolher(letras), escolher(numeros), escolher(simbolos)];
  while (base.length < 12) base.push(escolher(todos));
  // Embaralha (Fisher-Yates) para o padrão não ficar no começo.
  for (let i = base.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join('');
}
