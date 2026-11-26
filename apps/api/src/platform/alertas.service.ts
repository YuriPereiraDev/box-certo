import { Injectable } from '@nestjs/common';
import { minutosLocais } from '../common/utils/datas.js';
import { BancoService } from '../prisma/banco.service.js';

/** Limiares dos alertas de atividade suspeita (seção 9). */
export const LIMITES_ALERTA = {
  falhasDeLoginPorIp: 5,
  exclusoesPorAtorEm10Min: 10,
  /** Atividade de usuários de oficina entre 00:00 e 05:00 (horário de Brasília). */
  madrugadaInicioMin: 0,
  madrugadaFimMin: 5 * 60,
};

/** Ações que contam como exclusão (lógica) para "exclusões em massa". */
const ACOES_DE_EXCLUSAO = ['EXCLU', 'DESATIV', 'REMOV', 'CANCELAD'];

export function ehExclusao(acao: string): boolean {
  return ACOES_DE_EXCLUSAO.some((p) => acao.includes(p));
}

export function naMadrugada(data: Date): boolean {
  const m = minutosLocais(data);
  return m >= LIMITES_ALERTA.madrugadaInicioMin && m < LIMITES_ALERTA.madrugadaFimMin;
}

/**
 * Alertas calculados a partir do AuditLog: muitas falhas de login, exclusões em massa e
 * atividade fora do horário. São consultas; notificar o time (push/e-mail) fica para a fase 11.
 */
@Injectable()
export class AlertasService {
  constructor(private readonly banco: BancoService) {}

  async calcular(horas: number) {
    const desde = new Date(Date.now() - horas * 3_600_000);
    const db = this.banco.sistema;

    const [falhas, exclusoes, atividadeUsuarios] = await Promise.all([
      db.auditLog.groupBy({
        by: ['ip'],
        where: { acao: { in: ['LOGIN_FALHA', 'LOGIN_FALHA_2FA'] }, createdAt: { gte: desde } },
        _count: true,
        _max: { createdAt: true },
      }),
      db.auditLog.findMany({
        where: {
          createdAt: { gte: desde },
          atorId: { not: null },
          OR: ACOES_DE_EXCLUSAO.map((p) => ({ acao: { contains: p } })),
        },
        select: {
          atorId: true,
          atorNome: true,
          atorTipo: true,
          oficinaId: true,
          createdAt: true,
          acao: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      db.auditLog.findMany({
        where: { createdAt: { gte: desde }, atorTipo: 'USUARIO' },
        select: { atorId: true, atorNome: true, oficinaId: true, createdAt: true },
      }),
    ]);

    // Exclusões em massa: N ou mais do mesmo ator dentro de qualquer janela de 10 minutos.
    const porAtor = new Map<string, typeof exclusoes>();
    for (const e of exclusoes) porAtor.set(e.atorId!, [...(porAtor.get(e.atorId!) ?? []), e]);
    const exclusoesEmMassa = [...porAtor.values()]
      .map((lista) => {
        let maior = 0;
        for (let i = 0, j = 0; j < lista.length; j++) {
          while (lista[j].createdAt.getTime() - lista[i].createdAt.getTime() > 10 * 60_000) i++;
          maior = Math.max(maior, j - i + 1);
        }
        const p = lista[0];
        return {
          atorId: p.atorId,
          atorNome: p.atorNome,
          atorTipo: p.atorTipo,
          oficinaId: p.oficinaId,
          maiorSequencia10Min: maior,
          total: lista.length,
        };
      })
      .filter((x) => x.maiorSequencia10Min >= LIMITES_ALERTA.exclusoesPorAtorEm10Min);

    const madrugada = new Map<
      string,
      { atorId: string; atorNome: string | null; oficinaId: string | null; acoes: number }
    >();
    for (const a of atividadeUsuarios) {
      if (!a.atorId || !naMadrugada(a.createdAt)) continue;
      const x = madrugada.get(a.atorId) ?? {
        atorId: a.atorId,
        atorNome: a.atorNome,
        oficinaId: a.oficinaId,
        acoes: 0,
      };
      x.acoes++;
      madrugada.set(a.atorId, x);
    }

    return {
      janelaHoras: horas,
      falhasDeLogin: falhas
        .filter((f) => f._count >= LIMITES_ALERTA.falhasDeLoginPorIp)
        .map((f) => ({ ip: f.ip, tentativas: f._count, ultimaEm: f._max.createdAt }))
        .sort((a, b) => b.tentativas - a.tentativas),
      exclusoesEmMassa,
      foraDoHorario: [...madrugada.values()].sort((a, b) => b.acoes - a.acoes),
    };
  }
}
