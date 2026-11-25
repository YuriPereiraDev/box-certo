import { gerarCodigoConvite, motivoConviteInvalido } from './convites.service.js';

describe('convites', () => {
  it('gera códigos de 6 caracteres sem 0/O/1/I/L', () => {
    for (let i = 0; i < 500; i++) expect(gerarCodigoConvite()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });

  const base = { ativo: true, expiraEm: null, usos: 0, maxUsos: null };
  const agora = new Date('2026-06-01T12:00:00Z');

  it('convite válido', () => {
    expect(motivoConviteInvalido(base, agora)).toBeNull();
    expect(motivoConviteInvalido({ ...base, maxUsos: 3, usos: 2 }, agora)).toBeNull();
  });

  it('inativo, expirado e esgotado', () => {
    expect(motivoConviteInvalido({ ...base, ativo: false }, agora)).toBe('CONVITE_INATIVO');
    expect(
      motivoConviteInvalido({ ...base, expiraEm: new Date('2026-06-01T11:59:59Z') }, agora),
    ).toBe('CONVITE_EXPIRADO');
    expect(motivoConviteInvalido({ ...base, maxUsos: 1, usos: 1 }, agora)).toBe('CONVITE_ESGOTADO');
  });
});
