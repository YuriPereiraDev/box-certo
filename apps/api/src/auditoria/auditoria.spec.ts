import { protegerCampos } from '../prisma/extensao-auditoria.js';
import { acaoPadrao } from './auditoria.service.js';

describe('protegerCampos', () => {
  it('esconde senha, segredo TOTP e hashes, inclusive em objetos aninhados e listas', () => {
    const r = protegerCampos({
      nome: 'a',
      senhaHash: '$argon2id$...',
      admin: { totpSecret: 'v1:...' },
      tokens: [{ hash: 'abc' }],
    });
    expect(r).toEqual({
      nome: 'a',
      senhaHash: '[PROTEGIDO]',
      admin: { totpSecret: '[PROTEGIDO]' },
      tokens: [{ hash: '[PROTEGIDO]' }],
    });
  });

  it('converte datas para texto ISO e trata nulos', () => {
    const data = new Date('2026-01-01T00:00:00Z');
    expect(protegerCampos({ createdAt: data })).toEqual({ createdAt: '2026-01-01T00:00:00.000Z' });
    expect(protegerCampos(undefined)).toBeNull();
  });
});

describe('acaoPadrao', () => {
  it('monta o nome da ação a partir da entidade e da operação', () => {
    expect(acaoPadrao('User', 'update')).toBe('USER_ATUALIZADO');
    expect(acaoPadrao('ClienteOficina', 'create')).toBe('CLIENTE_OFICINA_CRIADO');
    expect(acaoPadrao('EstoqueItem', 'deleteMany')).toBe('ESTOQUE_ITEM_EXCLUIDOS');
  });
});
