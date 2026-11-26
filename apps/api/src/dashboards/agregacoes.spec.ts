import type { AtorUsuario } from '../common/contexto/contexto.js';
import {
  cardsDeFaturamento,
  custoDasPecas,
  faturamentoPorMes,
  maisFeitos,
  mesesAte,
  porMecanico,
  type OsParaIndicador,
} from './agregacoes.js';
import { podeVerDashboard, podeVerFinanceiro } from './dashboard.service.js';

const item = (
  o: Partial<OsParaIndicador['itens'][number]> = {},
): OsParaIndicador['itens'][number] => ({
  descricao: 'Serviço',
  tipo: 'MAO_DE_OBRA',
  quantidade: 1,
  precoUnitarioCentavos: 10_000,
  custoUnitarioCentavos: null,
  descontoTipo: null,
  descontoValor: null,
  descontoStatus: null,
  statusCliente: 'APROVADO',
  tabelaPrecoId: null,
  estoqueItemId: null,
  ...o,
});
const os = (o: Partial<OsParaIndicador> = {}): OsParaIndicador => ({
  id: Math.random().toString(36),
  mecanicoId: 'm1',
  pagoEm: new Date('2026-12-10T15:00:00Z'),
  concluidoEm: new Date('2026-12-10T15:00:00Z'),
  descontoTipo: null,
  descontoValor: null,
  descontoStatus: null,
  itens: [item()],
  ...o,
});

describe('agregações do dashboard', () => {
  it('faturamento, ticket médio e descontos (só aprovados e descontos aplicados)', () => {
    const c = cardsDeFaturamento([
      os({
        itens: [
          item({
            precoUnitarioCentavos: 20_000,
            descontoTipo: 'VALOR',
            descontoValor: 2_000,
            descontoStatus: 'APLICADO',
          }),
        ],
      }),
      os({ itens: [item(), item({ statusCliente: 'RECUSADO', precoUnitarioCentavos: 99_999 })] }),
      os({ descontoTipo: 'PERCENTUAL', descontoValor: 50, descontoStatus: 'PENDENTE_APROVACAO' }),
    ]);
    expect(c).toEqual({
      faturamentoCentavos: 18_000 + 10_000 + 10_000,
      quantidadeOs: 3,
      ticketMedioCentavos: Math.round(38_000 / 3),
      descontosCentavos: 2_000,
    });
    expect(cardsDeFaturamento([]).ticketMedioCentavos).toBe(0);
  });

  it('série de 12 meses com zeros e virada de ano', () => {
    expect(mesesAte('2027-02', 4)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    const serie = faturamentoPorMes(
      [os(), os({ pagoEm: new Date('2027-01-01T02:00:00Z') })], // 31/12 23h em São Paulo
      ['2026-11', '2026-12', '2027-01'],
    );
    expect(serie).toEqual([
      { mes: '2026-11', faturamentoCentavos: 0, quantidadeOs: 0 },
      { mes: '2026-12', faturamentoCentavos: 20_000, quantidadeOs: 2 },
      { mes: '2027-01', faturamentoCentavos: 0, quantidadeOs: 0 },
    ]);
  });

  it('por mecânico: faturamento das pagas, produtividade das concluídas', () => {
    const r = porMecanico(
      [os(), os({ mecanicoId: 'm2' }), os({ mecanicoId: 'm2' })],
      [os(), os()],
      [
        { id: 'm1', nome: 'Ana' },
        { id: 'm2', nome: 'Bia' },
      ],
    );
    expect(r.map((x) => [x.mecanico.nome, x.faturamentoCentavos, x.osConcluidas])).toEqual([
      ['Bia', 20_000, 0],
      ['Ana', 10_000, 2],
    ]);
  });

  it('mais feitos agrupa por tabela/estoque/descrição e ignora recusados', () => {
    const r = maisFeitos([
      os({
        itens: [
          item({ descricao: 'Alinhamento', tabelaPrecoId: 't1' }),
          item({ descricao: 'Filtro', tipo: 'PECA', quantidade: 2, estoqueItemId: 'e1' }),
        ],
      }),
      os({
        itens: [
          item({ descricao: 'Alinhamento (promo)', tabelaPrecoId: 't1' }),
          item({ descricao: 'filtro', tipo: 'PECA', estoqueItemId: 'e1' }),
        ],
      }),
      os({ itens: [item({ descricao: 'Pintura', statusCliente: 'RECUSADO' })] }),
    ]);
    expect(r.servicos).toEqual([
      {
        descricao: 'Alinhamento',
        tipo: 'MAO_DE_OBRA',
        quantidade: 2,
        quantidadeOs: 2,
        valorCentavos: 20_000,
      },
    ]);
    expect(r.pecas[0]).toMatchObject({ quantidade: 3, quantidadeOs: 2 });
  });

  it('custo das peças aprovadas', () => {
    expect(
      custoDasPecas([
        os({
          itens: [
            item({ tipo: 'PECA', quantidade: 3, custoUnitarioCentavos: 500 }),
            item({ tipo: 'PECA', custoUnitarioCentavos: 900, statusCliente: 'RECUSADO' }),
          ],
        }),
      ]),
    ).toBe(1_500);
  });
});

describe('acesso ao dashboard', () => {
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

  it('master, gerente e financeiro acessam; mecânico comum não', () => {
    expect(podeVerDashboard(ator({ role: 'MASTER' }))).toBe(true);
    expect(podeVerDashboard(ator({ permissoes: ['GERENTE'] }))).toBe(true);
    expect(podeVerDashboard(ator({ role: 'FINANCEIRO', permissoes: ['FINANCEIRO'] }))).toBe(true);
    expect(podeVerDashboard(ator({}))).toBe(false);
    expect(podeVerDashboard(ator({ role: 'FINANCEIRO' }))).toBe(false);
  });

  it('bloco financeiro: só MASTER ou FINANCEIRO', () => {
    expect(podeVerFinanceiro(ator({ permissoes: ['GERENTE'] }))).toBe(false);
    expect(podeVerFinanceiro(ator({ permissoes: ['FINANCEIRO'] }))).toBe(true);
  });
});
