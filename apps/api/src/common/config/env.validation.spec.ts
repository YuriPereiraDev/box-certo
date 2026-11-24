import { randomBytes } from 'node:crypto';
import { validarEnv } from './env.validation.js';

const base = () => ({
  DATABASE_URL: 'postgresql://u:s@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

describe('validarEnv', () => {
  it('aceita configuração válida e converte PORT para número', () => {
    const env = validarEnv({ ...base(), PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('recusa quando falta DATABASE_URL', () => {
    const { DATABASE_URL: _, ...semUrl } = base();
    expect(() => validarEnv(semUrl)).toThrow(/DATABASE_URL/);
  });

  it('recusa segredo JWT curto', () => {
    expect(() => validarEnv({ ...base(), JWT_ACCESS_SECRET: 'troque' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('recusa ENCRYPTION_KEY que não tem 32 bytes', () => {
    expect(() => validarEnv({ ...base(), ENCRYPTION_KEY: 'chave-32-bytes-base64' })).toThrow(
      /32 bytes/,
    );
  });
});
