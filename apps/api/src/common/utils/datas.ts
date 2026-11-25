/** Fuso de exibição e das regras de horário (seção 5). Datas são salvas em UTC. */
export const FUSO_PADRAO = 'America/Sao_Paulo';

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatadores.set(fuso, f);
  }
  return f;
}

/** Componentes da data no fuso informado. */
export function partesLocais(data: Date, fuso = FUSO_PADRAO) {
  const p = Object.fromEntries(
    formatador(fuso)
      .formatToParts(data)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return p;
}

/** Diferença em minutos entre o horário local e o UTC naquele instante (ex.: -180). */
export function offsetMinutos(data: Date, fuso = FUSO_PADRAO): number {
  const p = partesLocais(data, fuso);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((comoUtc - Math.floor(data.getTime() / 1000) * 1000) / 60_000);
}

/** "2026-12-01" + 540 min (09:00) no fuso local → instante UTC. */
export function localParaUtc(dataLocal: string, minutosDoDia: number, fuso = FUSO_PADRAO): Date {
  const [a, m, d] = dataLocal.split('-').map(Number);
  const base = Date.UTC(a, m - 1, d, 0, minutosDoDia);
  let instante = base - offsetMinutos(new Date(base), fuso) * 60_000;
  // Segunda passada corrige mudanças de offset (horário de verão) perto do instante.
  instante = base - offsetMinutos(new Date(instante), fuso) * 60_000;
  return new Date(instante);
}

/** "YYYY-MM-DD" da data no fuso local. */
export function dataLocal(data: Date, fuso = FUSO_PADRAO): string {
  const p = partesLocais(data, fuso);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minutos desde 00:00 no fuso local. */
export function minutosLocais(data: Date, fuso = FUSO_PADRAO): number {
  const p = partesLocais(data, fuso);
  return p.hour * 60 + p.minute;
}

/** 0 = domingo ... 6 = sábado para uma data "YYYY-MM-DD". */
export function diaDaSemana(dataLocal: string): number {
  const [a, m, d] = dataLocal.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** Soma dias a uma data "YYYY-MM-DD". */
export function somarDias(dataLocal: string, dias: number): string {
  const [a, m, d] = dataLocal.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function minutosParaHora(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}
