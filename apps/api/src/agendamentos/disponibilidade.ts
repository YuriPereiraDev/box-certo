import { horaParaMinutos } from '../common/utils/documentos.js';
import {
  dataLocal,
  diaDaSemana,
  FUSO_PADRAO,
  localParaUtc,
  minutosLocais,
  minutosParaHora,
} from '../common/utils/datas.js';

/** Status que ocupam a agenda. */
export const STATUS_QUE_OCUPAM = ['AGENDADO', 'CONFIRMADO', 'EM_ATENDIMENTO'] as const;

export interface HorarioDoDia {
  abre: string;
  fecha: string;
  intervaloInicio: string | null;
  intervaloFim: string | null;
}

export interface Ocupacao {
  id: string;
  inicio: Date;
  fim: Date;
  mecanicoId: string | null;
}

export interface Slot {
  inicio: Date;
  fim: Date;
  hora: string;
}

const sobrepoe = (a: { inicio: Date; fim: Date }, b: { inicio: Date; fim: Date }) =>
  a.inicio < b.fim && b.inicio < a.fim;

/**
 * O intervalo [inicio, fim) cabe no expediente do dia (mesmo dia local, dentro de abre–fecha,
 * sem pegar o intervalo de almoço)?
 */
export function cabeNoExpediente(
  horario: HorarioDoDia | null,
  inicio: Date,
  fim: Date,
  fuso = FUSO_PADRAO,
): boolean {
  if (!horario) return false;
  if (dataLocal(inicio, fuso) !== dataLocal(new Date(fim.getTime() - 1), fuso)) return false;
  const ini = minutosLocais(inicio, fuso);
  const dur = Math.round((fim.getTime() - inicio.getTime()) / 60_000);
  const f = ini + dur;
  if (ini < horaParaMinutos(horario.abre) || f > horaParaMinutos(horario.fecha)) return false;
  if (horario.intervaloInicio && horario.intervaloFim) {
    const ii = horaParaMinutos(horario.intervaloInicio);
    const fi = horaParaMinutos(horario.intervaloFim);
    if (ini < fi && ii < f) return false;
  }
  return true;
}

/**
 * Há mecânico para o intervalo?
 * - Com mecânico definido: ele precisa estar livre (ativo e sem outro agendamento sobreposto).
 * - Sem mecânico: o número de mecânicos sem agendamento atribuído no intervalo precisa ser
 *   maior que o número de agendamentos sem mecânico que se sobrepõem a ele. Assim cada
 *   agendamento ainda sem mecânico tem alguém livre para o período inteiro.
 */
export function temMecanicoLivre(
  intervalo: { inicio: Date; fim: Date },
  mecanicosAtivos: string[],
  ocupacoes: Ocupacao[],
  opcoes: { mecanicoId?: string | null; ignorarId?: string } = {},
): boolean {
  const conflitantes = ocupacoes.filter((o) => o.id !== opcoes.ignorarId && sobrepoe(o, intervalo));
  if (opcoes.mecanicoId) {
    return (
      mecanicosAtivos.includes(opcoes.mecanicoId) &&
      !conflitantes.some((o) => o.mecanicoId === opcoes.mecanicoId)
    );
  }
  const ocupados = new Set(conflitantes.filter((o) => o.mecanicoId).map((o) => o.mecanicoId));
  const livres = mecanicosAtivos.filter((m) => !ocupados.has(m)).length;
  const semMecanico = conflitantes.filter((o) => !o.mecanicoId).length;
  return livres > semMecanico;
}

export interface ParametrosSlots {
  data: string; // "YYYY-MM-DD" local
  horario: HorarioDoDia | null;
  duracaoMin: number;
  passoMin: number;
  agora: Date;
  mecanicosAtivos: string[];
  ocupacoes: Ocupacao[];
  mecanicoId?: string | null;
  ignorarId?: string;
  fuso?: string;
}

/** Horários livres do dia, de `passoMin` em `passoMin` minutos a partir da abertura. */
export function calcularSlots(p: ParametrosSlots): Slot[] {
  const fuso = p.fuso ?? FUSO_PADRAO;
  if (!p.horario) return [];
  const abre = horaParaMinutos(p.horario.abre);
  const fecha = horaParaMinutos(p.horario.fecha);
  const slots: Slot[] = [];
  for (let m = abre; m + p.duracaoMin <= fecha; m += p.passoMin) {
    const inicio = localParaUtc(p.data, m, fuso);
    const fim = new Date(inicio.getTime() + p.duracaoMin * 60_000);
    if (inicio <= p.agora) continue;
    if (!cabeNoExpediente(p.horario, inicio, fim, fuso)) continue;
    if (
      !temMecanicoLivre({ inicio, fim }, p.mecanicosAtivos, p.ocupacoes, {
        mecanicoId: p.mecanicoId,
        ignorarId: p.ignorarId,
      })
    ) {
      continue;
    }
    slots.push({ inicio, fim, hora: minutosParaHora(m) });
  }
  return slots;
}

export { diaDaSemana };
