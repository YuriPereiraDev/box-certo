import { execSync } from 'node:child_process';
import pg from 'pg';
import { garantirUsuarioApp } from '../prisma/usuario-app.js';
import { urlsBancoTeste } from './banco-teste.js';

/**
 * Antes da suíte e2e: cria o banco de testes (se não existir), aplica as migrações como dono
 * e garante o usuário restrito da API — os testes rodam com os mesmos privilégios de produção.
 */
export default async function setup(): Promise<void> {
  const { app, migracao } = urlsBancoTeste();
  const url = new URL(migracao);
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
    env: { ...process.env, DATABASE_URL_MIGRACAO: migracao, DATABASE_URL: app },
  });
  if (app !== migracao) await garantirUsuarioApp(migracao, app);
}
