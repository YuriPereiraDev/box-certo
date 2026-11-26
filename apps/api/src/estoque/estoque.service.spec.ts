import type { AtorUsuario } from '../common/contexto/contexto.js';
import type { EstoqueItem } from '../generated/prisma/client.js';
import { apresentarPeca, custoMedio } from './estoque.service.js';

describe('custo médio ponderado', () => {
  it('pondera pelas quantidades e arredonda em centavos', () => {
    expect(custoMedio(10, 1_000, 10, 1_400)).toBe(1_200);
    expect(custoMedio(3, 1_000, 1, 1_001)).toBe(1_000); // 1000,25 → 1000
    expect(custoMedio(1, 999, 2, 1_000)).toBe(1_000); // 999,67 → 1000
  });

  it('estoque zerado assume o custo da compra', () => {
    expect(custoMedio(0, 5_000, 4, 1_200)).toBe(1_200);
  });
});

describe('apresentarPeca', () => {
  const p = {
    id: 'p',
    oficinaId: 'o',
    nome: 'Filtro',
    quantidade: 5,
    quantidadeReservada: 2,
    custoCentavos: 900,
    estoqueMinimo: 5,
    ativo: true,
  } as EstoqueItem;
  const ator = (o: Partial<AtorUsuario>): AtorUsuario => ({
    tipo: 'USUARIO',
    id: 'u',
    nome: 'U',
    email: 'u@x',
    oficinaId: 'o',
    role: 'MECANICO',
    permissoes: [],
    ...o,
  });

  it('calcula disponível e alerta de mínimo', () => {
    expect(apresentarPeca(p, ator({}))).toMatchObject({ disponivel: 3, abaixoDoMinimo: true });
  });

  it('custo só para MASTER ou permissão FINANCEIRO (GERIR_ESTOQUE não vê)', () => {
    expect(apresentarPeca(p, ator({ permissoes: ['GERIR_ESTOQUE'] }))).not.toHaveProperty(
      'custoCentavos',
    );
    expect(apresentarPeca(p, ator({ role: 'MASTER' })).custoCentavos).toBe(900);
    expect(apresentarPeca(p, ator({ permissoes: ['FINANCEIRO'] })).custoCentavos).toBe(900);
  });
});
