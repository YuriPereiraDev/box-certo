import { execSync } from 'node:child_process';
import pg from 'pg';
import { urlBancoTeste } from './banco-teste.js';

/** Cria o banco de testes (se não existir) e aplica as migrações antes da suíte e2e. */
export default async function setup(): Promise<void> {
  const url = new URL(urlBancoTeste());
  const nome = url.pathname.replace(/^\//, '');
  if (!/^[a-z0-9_]+$/i.test(nome)) throw new Error(`Nome de banco de teste inválido: ${nome}`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const cliente = new pg.Client({ connectionString: admin.toString() });
  await cliente.connect();
  try {
    const existe = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [nome]);
    if (existe.rowCount === 0) await cliente.query(`CREATE DATABASE "${nome}"`);
  } finally {
    await cliente.end();
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url.toString() },
  });
}
