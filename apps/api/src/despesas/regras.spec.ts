import type { AtorUsuario } from '../common/contexto/contexto.js';
import { dataLocal } from '../common/utils/datas.js';
import {
  competenciaDe,
  deveGerarNaCompetencia,
  podeVerSalarios,
  vencimentoNaCompetencia,
} from './regras.js';

const ator = (o: Partial<AtorUsuario>): AtorUsuario => ({
  tipo: 'USUARIO',
  id: 'u',
  nome: 'U',
  email: 'u@x',
  oficinaId: 'o',
  role: 'FINANCEIRO',
  permissoes: [],
  ...o,
});

describe('regras de despesas', () => {
  it('salários: MASTER ou FINANCEIRO + VER_SALARIOS', () => {
    expect(podeVerSalarios(ator({ role: 'MASTER' }))).toBe(true);
    expect(podeVerSalarios(ator({ permissoes: ['FINANCEIRO', 'VER_SALARIOS'] }))).toBe(true);
    expect(podeVerSalarios(ator({ permissoes: ['FINANCEIRO'] }))).toBe(false);
    expect(podeVerSalarios(ator({ permissoes: ['VER_SALARIOS'] }))).toBe(false);
  });

  it('competência no fuso de São Paulo', () => {
    expect(competenciaDe(new Date('2026-12-01T02:00:00Z'))).toBe('2026-11'); // 30/11 23h local
    expect(competenciaDe(new Date('2026-12-01T12:00:00Z'))).toBe('2026-12');
  });

  it('vencimento usa o último dia em meses curtos', () => {
    expect(dataLocal(vencimentoNaCompetencia('2027-02', 31))).toBe('2027-02-28');
    expect(dataLocal(vencimentoNaCompetencia('2028-02', 30))).toBe('2028-02-29');
    expect(dataLocal(vencimentoNaCompetencia('2026-04', 31))).toBe('2026-04-30');
    expect(dataLocal(vencimentoNaCompetencia('2026-12', 10))).toBe('2026-12-10');
  });

  it('cadastrada no meio do mês só gera o mês atual se o vencimento não passou', () => {
    const dia15 = new Date('2026-12-15T15:00:00Z');
    expect(deveGerarNaCompetencia(dia15, '2026-12', 20)).toBe(true);
    expect(deveGerarNaCompetencia(dia15, '2026-12', 15)).toBe(true); // vence hoje
    expect(deveGerarNaCompetencia(dia15, '2026-12', 10)).toBe(false);
    expect(deveGerarNaCompetencia(dia15, '2027-01', 10)).toBe(true); // próximo mês sempre
  });
});
