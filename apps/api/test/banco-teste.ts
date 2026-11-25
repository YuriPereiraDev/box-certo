import { config } from 'dotenv';

/** URL do banco de testes: mesmo servidor do .env, banco com sufixo `_test`. */
export function urlBancoTeste(): string {
  config({ path: ['.env', '../../.env'], quiet: true });
  const base = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL não definida no .env');
  if (process.env.DATABASE_URL_TEST) return base;
  const url = new URL(base);
  const nome = url.pathname.replace(/^\//, '');
  if (!nome.endsWith('_test')) url.pathname = `/${nome}_test`;
  return url.toString();
}
