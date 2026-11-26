import { config } from 'dotenv';

function paraTeste(base: string): string {
  const url = new URL(base);
  const nome = url.pathname.replace(/^\//, '');
  if (!nome.endsWith('_test')) url.pathname = `/${nome}_test`;
  return url.toString();
}

/**
 * Banco de testes: mesmo servidor do .env, banco com sufixo `_test`.
 * - `app`: usuário restrito da API (como em produção);
 * - `migracao`: dono do banco (cria o banco, aplica migrações, roda o seed).
 */
export function urlsBancoTeste(): { app: string; migracao: string } {
  config({ path: ['.env', '../../.env'], quiet: true });
  const app = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  const migracao =
    process.env.DATABASE_URL_MIGRACAO_TEST ?? process.env.DATABASE_URL_MIGRACAO ?? app;
  if (!app || !migracao) throw new Error('DATABASE_URL não definida no .env');
  return {
    app: process.env.DATABASE_URL_TEST ?? paraTeste(app),
    migracao: process.env.DATABASE_URL_MIGRACAO_TEST ?? paraTeste(migracao),
  };
}

/** URL do usuário da API no banco de testes. */
export function urlBancoTeste(): string {
  return urlsBancoTeste().app;
}
