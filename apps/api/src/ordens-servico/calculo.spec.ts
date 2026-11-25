import { ForbiddenException } from '@nestjs/common';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import { calcularTotais, valorDoDesconto, valoresDoItem, type ItemParaCalculo } from './calculo.js';
import { decidirDesconto, excedeLimite } from './regras-desconto.js';

const item = (o: Partial<ItemParaCalculo> = {}): ItemParaCalculo => ({
  quantidade: 1,
  precoUnitarioCentavos: 10_000,
  descontoTipo: null,
  descontoValor: null,
  descontoStatus: null,
  statusCliente: 'APROVADO',
  ...o,
});
const semDesconto = { descontoTipo: null, descontoValor: null, descontoStatus: null };

describe('cálculo do orçamento (centavos)', () => {
  it('desconto percentual arredonda e nunca passa da base', () => {
    expect(valorDoDesconto(9_999, 'PERCENTUAL', 10)).toBe(1_000);
    expect(valorDoDesconto(5_000, 'VALOR', 8_000)).toBe(5_000);
    expect(valorDoDesconto(5_000, 'PERCENTUAL', 150)).toBe(5_000);
    expect(valorDoDesconto(0, 'VALOR', 100)).toBe(0);
  });

  it('desconto do item só conta quando APLICADO', () => {
    const base = {
      quantidade: 2,
      precoUnitarioCentavos: 5_000,
      descontoTipo: 'VALOR' as const,
      descontoValor: 1_000,
    };
    expect(valoresDoItem(item({ ...base, descontoStatus: 'APLICADO' })).totalCentavos).toBe(9_000);
    expect(
      valoresDoItem(item({ ...base, descontoStatus: 'PENDENTE_APROVACAO' })).totalCentavos,
    ).toBe(10_000);
    expect(valoresDoItem(item({ ...base, descontoStatus: 'RECUSADO' })).totalCentavos).toBe(10_000);
  });

  it('total = itens aprovados − descontos dos itens − desconto da OS', () => {
    const itens = [
      item({
        precoUnitarioCentavos: 20_000,
        descontoTipo: 'PERCENTUAL',
        descontoValor: 10,
        descontoStatus: 'APLICADO',
      }),
      item({ precoUnitarioCentavos: 5_000 }),
      item({ precoUnitarioCentavos: 30_000, statusCliente: 'RECUSADO' }),
      item({ precoUnitarioCentavos: 7_000, statusCliente: 'PENDENTE' }),
    ];
    const t = calcularTotais(itens, {
      descontoTipo: 'VALOR',
      descontoValor: 1_500,
      descontoStatus: 'APLICADO',
    });
    expect(t.aprovado).toEqual({
      brutoCentavos: 25_000,
      descontoItensCentavos: 2_000,
      subtotalCentavos: 23_000,
      descontoOsCentavos: 1_500,
      totalCentavos: 21_500,
    });
    expect(t.orcado.brutoCentavos).toBe(32_000);
    expect(t.orcado.totalCentavos).toBe(32_000 - 2_000 - 1_500);
  });

  it('desconto da OS pendente não reduz o total', () => {
    const t = calcularTotais([item()], {
      descontoTipo: 'PERCENTUAL',
      descontoValor: 50,
      descontoStatus: 'PENDENTE_APROVACAO',
    });
    expect(t.aprovado.totalCentavos).toBe(10_000);
    expect(calcularTotais([item()], semDesconto).aprovado.descontoOsCentavos).toBe(0);
  });
});

describe('regras de desconto', () => {
  const usuario = (o: Partial<AtorUsuario>): AtorUsuario => ({
    tipo: 'USUARIO',
    id: 'mec',
    nome: 'M',
    email: 'm@x',
    oficinaId: 'of',
    role: 'MECANICO',
    permissoes: [],
    ...o,
  });
  const permitido = {
    mecanicoPodeDarDesconto: true,
    limiteDescontoPercentual: 10,
    limiteDescontoCentavos: 5_000,
  };

  it('limites percentual e em reais', () => {
    expect(excedeLimite(1_000, 10_000, permitido)).toBe(false);
    expect(excedeLimite(1_001, 10_000, permitido)).toBe(true);
    expect(excedeLimite(5_001, 100_000, permitido)).toBe(true);
    expect(
      excedeLimite(9_999, 100, {
        ...permitido,
        limiteDescontoPercentual: null,
        limiteDescontoCentavos: null,
      }),
    ).toBe(false);
  });

  it('master e gerente aplicam direto, em qualquer OS', () => {
    expect(
      decidirDesconto(usuario({ role: 'MASTER', id: 'x' }), 'mec', 99_999, 100, permitido),
    ).toBe('APLICADO');
    expect(
      decidirDesconto(usuario({ id: 'g', permissoes: ['GERENTE'] }), 'mec', 99_999, 100, permitido),
    ).toBe('APLICADO');
  });

  it('mecânico na própria OS: aplica dentro do limite, pede aprovação acima ou sem permissão', () => {
    const m = usuario({});
    expect(decidirDesconto(m, 'mec', 1_000, 10_000, permitido)).toBe('APLICADO');
    expect(decidirDesconto(m, 'mec', 2_000, 10_000, permitido)).toBe('PENDENTE_APROVACAO');
    expect(
      decidirDesconto(m, 'mec', 100, 10_000, { ...permitido, mecanicoPodeDarDesconto: false }),
    ).toBe('PENDENTE_APROVACAO');
  });

  it('mecânico em OS de outro mecânico ou financeiro sem GERENTE: 403', () => {
    expect(() => decidirDesconto(usuario({}), 'outro', 100, 10_000, permitido)).toThrow(
      ForbiddenException,
    );
    expect(() =>
      decidirDesconto(usuario({ role: 'FINANCEIRO' }), 'mec', 100, 10_000, permitido),
    ).toThrow(ForbiddenException);
  });
});

describe('formatação no PDF', () => {
  it('mascara documento e telefone', async () => {
    const { formatarDocumento, formatarTelefone } = await import('./pdf.service.js');
    expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
    expect(formatarTelefone('11988887777')).toBe('(11) 98888-7777');
    expect(formatarTelefone('1133334444')).toBe('(11) 3333-4444');
  });
});
