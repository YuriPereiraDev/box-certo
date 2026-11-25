import { dataLocal, localParaUtc, minutosLocais, somarDias } from '../common/utils/datas.js';
import {
  cabeNoExpediente,
  calcularSlots,
  temMecanicoLivre,
  type HorarioDoDia,
  type Ocupacao,
} from './disponibilidade.js';

const DIA = '2026-12-01'; // terça
const H = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return localParaUtc(DIA, h * 60 + m);
};
const horario: HorarioDoDia = {
  abre: '08:00',
  fecha: '18:00',
  intervaloInicio: '12:00',
  intervaloFim: '13:00',
};
const ANTES = new Date('2026-11-01T00:00:00Z');

describe('datas (America/Sao_Paulo)', () => {
  it('converte horário local para UTC (-03:00)', () => {
    expect(localParaUtc(DIA, 9 * 60).toISOString()).toBe('2026-12-01T12:00:00.000Z');
    expect(dataLocal(new Date('2026-12-02T02:30:00Z'))).toBe('2026-12-01');
    expect(minutosLocais(new Date('2026-12-01T12:30:00Z'))).toBe(9 * 60 + 30);
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('cabeNoExpediente', () => {
  it('respeita abertura, fechamento e almoço', () => {
    expect(cabeNoExpediente(horario, H('08:00'), H('09:00'))).toBe(true);
    expect(cabeNoExpediente(horario, H('07:30'), H('08:30'))).toBe(false);
    expect(cabeNoExpediente(horario, H('17:30'), H('18:30'))).toBe(false);
    expect(cabeNoExpediente(horario, H('11:30'), H('12:30'))).toBe(false);
    expect(cabeNoExpediente(horario, H('11:00'), H('12:00'))).toBe(true);
    expect(cabeNoExpediente(horario, H('13:00'), H('14:00'))).toBe(true);
    expect(cabeNoExpediente(null, H('09:00'), H('10:00'))).toBe(false);
  });
});

describe('temMecanicoLivre', () => {
  const oc = (id: string, ini: string, fim: string, mecanicoId: string | null): Ocupacao => ({
    id,
    inicio: H(ini),
    fim: H(fim),
    mecanicoId,
  });
  const intervalo = { inicio: H('09:00'), fim: H('10:00') };

  it('mecânico específico precisa estar livre e ativo', () => {
    expect(
      temMecanicoLivre(intervalo, ['m1'], [oc('a', '09:30', '10:30', 'm1')], { mecanicoId: 'm1' }),
    ).toBe(false);
    expect(
      temMecanicoLivre(intervalo, ['m1'], [oc('a', '10:00', '11:00', 'm1')], { mecanicoId: 'm1' }),
    ).toBe(true);
    expect(temMecanicoLivre(intervalo, ['m1'], [], { mecanicoId: 'inativo' })).toBe(false);
  });

  it('sem mecânico: um atendimento por mecânico ativo', () => {
    expect(temMecanicoLivre(intervalo, ['m1'], [])).toBe(true);
    expect(temMecanicoLivre(intervalo, ['m1'], [oc('a', '09:00', '10:00', null)])).toBe(false);
    expect(temMecanicoLivre(intervalo, ['m1', 'm2'], [oc('a', '09:00', '10:00', null)])).toBe(true);
    expect(
      temMecanicoLivre(
        intervalo,
        ['m1', 'm2'],
        [oc('a', '09:00', '10:00', null), oc('b', '09:30', '10:30', 'm2')],
      ),
    ).toBe(false);
  });

  it('ignora o próprio agendamento ao reagendar', () => {
    expect(
      temMecanicoLivre(intervalo, ['m1'], [oc('a', '09:00', '10:00', null)], { ignorarId: 'a' }),
    ).toBe(true);
  });
});

describe('calcularSlots', () => {
  const base = {
    data: DIA,
    horario,
    duracaoMin: 60,
    passoMin: 30,
    agora: ANTES,
    mecanicosAtivos: ['m1'],
    ocupacoes: [] as Ocupacao[],
  };

  it('gera horários de 30 em 30 min sem cruzar o almoço nem o fechamento', () => {
    const horas = calcularSlots(base).map((s) => s.hora);
    expect(horas[0]).toBe('08:00');
    expect(horas).toContain('11:00');
    expect(horas).not.toContain('11:30');
    expect(horas).not.toContain('12:00');
    expect(horas).toContain('13:00');
    expect(horas.at(-1)).toBe('17:00');
    expect(horas).toHaveLength(16);
  });

  it('remove horários ocupados e horários no passado', () => {
    const ocupado = calcularSlots({
      ...base,
      ocupacoes: [{ id: 'a', inicio: H('09:00'), fim: H('10:00'), mecanicoId: null }],
    }).map((s) => s.hora);
    expect(ocupado).not.toContain('08:30');
    expect(ocupado).not.toContain('09:00');
    expect(ocupado).not.toContain('09:30');
    expect(ocupado).toContain('10:00');

    const tarde = calcularSlots({ ...base, agora: H('15:10') }).map((s) => s.hora);
    expect(tarde).toEqual(['15:30', '16:00', '16:30', '17:00']);
  });

  it('dia fechado ou sem mecânico ativo: nenhum horário', () => {
    expect(calcularSlots({ ...base, horario: null })).toEqual([]);
    expect(calcularSlots({ ...base, mecanicosAtivos: [] })).toEqual([]);
  });
});
