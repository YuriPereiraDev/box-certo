import { aplicarFiltroTenant } from './extensao-tenant.js';

const OF = 'oficina-do-token';

describe('aplicarFiltroTenant', () => {
  it.each([
    'findUnique',
    'findFirst',
    'findMany',
    'count',
    'update',
    'updateMany',
    'delete',
    'deleteMany',
  ])('%s: injeta oficinaId no where', (op) => {
    expect(aplicarFiltroTenant(op, { where: { id: 'x' } }, OF).where).toEqual({
      id: 'x',
      oficinaId: OF,
    });
  });

  it('sobrescreve um oficinaId diferente no where', () => {
    const r = aplicarFiltroTenant('findMany', { where: { oficinaId: 'outra' } }, OF);
    expect(r.where).toEqual({ oficinaId: OF });
  });

  it('findMany sem argumentos também é filtrado', () => {
    expect(aplicarFiltroTenant('findMany', undefined, OF).where).toEqual({ oficinaId: OF });
  });

  it('create: força o oficinaId do token nos dados', () => {
    const r = aplicarFiltroTenant('create', { data: { nome: 'a', oficinaId: 'outra' } }, OF);
    expect(r.data).toEqual({ nome: 'a', oficinaId: OF });
  });

  it('createMany: força o oficinaId em todos os itens', () => {
    const r = aplicarFiltroTenant('createMany', { data: [{ n: 1 }, { n: 2, oficinaId: 'x' }] }, OF);
    expect(r.data).toEqual([
      { n: 1, oficinaId: OF },
      { n: 2, oficinaId: OF },
    ]);
  });

  it('update: não deixa mudar o registro de oficina', () => {
    const r = aplicarFiltroTenant(
      'update',
      { where: { id: '1' }, data: { nome: 'b', oficinaId: 'x' } },
      OF,
    );
    expect(r.data).toEqual({ nome: 'b' });
  });

  it('upsert: filtra o where, força no create e remove do update', () => {
    const r = aplicarFiltroTenant(
      'upsert',
      { where: { id: '1' }, create: { nome: 'c' }, update: { oficinaId: 'x', nome: 'd' } },
      OF,
    );
    expect(r).toEqual({
      where: { id: '1', oficinaId: OF },
      create: { nome: 'c', oficinaId: OF },
      update: { nome: 'd' },
    });
  });
});
