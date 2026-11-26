/**
 * Cria (ou atualiza a senha de) o usuário de banco da API e o coloca no grupo
 * `boxcerto_app_grupo` (privilégios mínimos: sem DELETE/TRUNCATE; AuditLog só SELECT/INSERT).
 *
 * Usa DATABASE_URL_MIGRACAO (dono do banco) para criar o usuário descrito em DATABASE_URL.
 * Uso: npm run db:usuario-app
 */
import { config } from 'dotenv';
import pg from 'pg';

const IDENTIFICADOR = /^[a-z_][a-z0-9_]{0,62}$/;

export async function garantirUsuarioApp(urlMigracao: string, urlApp: string): Promise<string> {
  const app = new URL(urlApp);
  const dono = new URL(urlMigracao);
  const usuario = decodeURIComponent(app.username);
  const senha = decodeURIComponent(app.password);
  if (!IDENTIFICADOR.test(usuario)) throw new Error(`Nome de usuário inválido: ${usuario}`);
  if (usuario === decodeURIComponent(dono.username)) {
    throw new Error('DATABASE_URL precisa usar um usuário diferente do dono (DATABASE_URL_MIGRACAO)');
  }
  if (senha.length < 12) throw new Error('A senha do usuário da API precisa ter 12+ caracteres');

  const cliente = new pg.Client({ connectionString: urlMigracao });
  await cliente.connect();
  try {
    const existe = await cliente.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [usuario]);
    // Identificador validado acima; a senha vai como literal escapado pelo próprio Postgres.
    const literal = (await cliente.query('SELECT quote_literal($1) AS s', [senha])).rows[0] as {
      s: string;
    };
    if (existe.rowCount === 0) {
      await cliente.query(`CREATE ROLE ${usuario} LOGIN PASSWORD ${literal.s}`);
    } else {
      await cliente.query(`ALTER ROLE ${usuario} WITH LOGIN PASSWORD ${literal.s}`);
    }
    await cliente.query(`GRANT boxcerto_app_grupo TO ${usuario}`);
    // Nunca dono de nada, nunca superusuário.
    await cliente.query(`ALTER ROLE ${usuario} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  } finally {
    await cliente.end();
  }
  return usuario;
}

async function main() {
  config({ path: ['.env', '../../.env'], quiet: true });
  const urlMigracao = process.env.DATABASE_URL_MIGRACAO;
  const urlApp = process.env.DATABASE_URL;
  if (!urlMigracao || !urlApp) {
    throw new Error('Defina DATABASE_URL (usuário da API) e DATABASE_URL_MIGRACAO (dono) no .env');
  }
  const usuario = await garantirUsuarioApp(urlMigracao, urlApp);
  console.log(`Usuário de banco da API pronto: ${usuario} (grupo boxcerto_app_grupo)`);
}

if (process.argv[1]?.endsWith('usuario-app.ts')) {
  main().catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exit(1);
  });
}
