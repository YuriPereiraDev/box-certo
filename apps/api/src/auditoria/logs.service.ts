import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { BancoService } from '../prisma/banco.service.js';
import type { FiltroLogsDto, FiltroLogsPlataformaDto } from './logs.dto.js';

const NOME_SUPORTE = 'Suporte Box Certo';

function montarWhere(f: FiltroLogsDto): Prisma.AuditLogWhereInput {
  return {
    acao: f.acao,
    entidade: f.entidade,
    entidadeId: f.entidadeId,
    atorId: f.atorId,
    atorTipo: f.atorTipo,
    createdAt: f.de || f.ate ? { gte: f.de, lte: f.ate } : undefined,
  };
}

/** Leitura de logs. Não existe escrita aqui: AuditLog é somente inserção. */
@Injectable()
export class LogsService {
  constructor(private readonly banco: BancoService) {}

  /** Logs da própria oficina (filtro de tenant). Ações do suporte aparecem como "Suporte Box Certo". */
  async daOficina(f: FiltroLogsDto) {
    const where = montarWhere(f);
    const [itens, total] = await Promise.all([
      this.banco.tenant.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (f.pagina - 1) * f.limite,
        take: f.limite,
      }),
      this.banco.tenant.auditLog.count({ where }),
    ]);
    return {
      itens: itens.map((l) =>
        l.atorTipo === 'SUPORTE' ? { ...l, atorId: null, atorNome: NOME_SUPORTE } : l,
      ),
      total,
      pagina: f.pagina,
      limite: f.limite,
    };
  }

  /** Logs de todas as oficinas e dos admins (painel da plataforma). */
  async daPlataforma(f: FiltroLogsPlataformaDto) {
    const where = { ...montarWhere(f), oficinaId: f.oficinaId };
    const [itens, total] = await Promise.all([
      this.banco.sistema.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (f.pagina - 1) * f.limite,
        take: f.limite,
      }),
      this.banco.sistema.auditLog.count({ where }),
    ]);
    return { itens, total, pagina: f.pagina, limite: f.limite };
  }
}
