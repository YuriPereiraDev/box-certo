import { contaNoLimite } from '../common/utils/plano.service.js';
import { validarPermissoes } from './usuarios.service.js';

describe('regras de usuários', () => {
  it('VER_SALARIOS exige FINANCEIRO', () => {
    expect(() => validarPermissoes(['VER_SALARIOS'])).toThrow(/FINANCEIRO/);
    expect(() => validarPermissoes(['FINANCEIRO', 'VER_SALARIOS'])).not.toThrow();
    expect(() => validarPermissoes(['GERENTE', 'VER_LOGS'])).not.toThrow();
  });

  it('master e mecânico contam no limite do plano; financeiro não', () => {
    expect(contaNoLimite('MASTER')).toBe(true);
    expect(contaNoLimite('MECANICO')).toBe(true);
    expect(contaNoLimite('FINANCEIRO')).toBe(false);
  });
});
