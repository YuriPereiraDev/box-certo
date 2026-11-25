import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { CriptografiaService } from './criptografia.service.js';

const criar = (chave = randomBytes(32).toString('base64')) =>
  new CriptografiaService({ getOrThrow: () => chave } as unknown as ConfigService);

describe('CriptografiaService (AES-256-GCM)', () => {
  it('criptografa e descriptografa', () => {
    const s = criar();
    const c = s.criptografar('segredo-totp');
    expect(c).not.toContain('segredo-totp');
    expect(s.descriptografar(c)).toBe('segredo-totp');
  });

  it('gera saídas diferentes para o mesmo texto (IV aleatório)', () => {
    const s = criar();
    expect(s.criptografar('x')).not.toBe(s.criptografar('x'));
  });

  it('recusa conteúdo adulterado', () => {
    const s = criar();
    const partes = s.criptografar('valor').split(':');
    partes[3] = Buffer.from('outro').toString('base64');
    expect(() => s.descriptografar(partes.join(':'))).toThrow();
  });

  it('recusa chave diferente', () => {
    const c = criar().criptografar('valor');
    expect(() => criar().descriptografar(c)).toThrow();
  });
});
