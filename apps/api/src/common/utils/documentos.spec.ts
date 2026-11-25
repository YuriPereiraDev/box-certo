import { cnpjValido, documentoValido, normalizarPlaca, placaValida } from './documentos.js';

describe('documentos', () => {
  it('valida CNPJ', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-80')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
  });

  it('documentoValido aceita CPF ou CNPJ', () => {
    expect(documentoValido('529.982.247-25')).toBe(true);
    expect(documentoValido('11222333000181')).toBe(true);
    expect(documentoValido('123')).toBe(false);
  });

  it('placa antiga e Mercosul, com ou sem hífen', () => {
    expect(normalizarPlaca('abc-1234')).toBe('ABC1234');
    expect(placaValida('ABC-1234')).toBe(true);
    expect(placaValida('abc1d23')).toBe(true);
    expect(placaValida('AB12345')).toBe(false);
    expect(placaValida('ABCD123')).toBe(false);
  });
});
