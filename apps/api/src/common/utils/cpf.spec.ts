import { cpfValido, gerarCpf } from './cpf.js';

describe('cpfValido', () => {
  it('aceita CPF válido com e sem máscara', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
  });

  it('recusa dígito verificador errado, tamanho errado e repetidos', () => {
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('1234567890')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
  });

  it('gerarCpf sempre gera CPF válido', () => {
    for (let i = 0; i < 200; i++) expect(cpfValido(gerarCpf())).toBe(true);
  });
});
