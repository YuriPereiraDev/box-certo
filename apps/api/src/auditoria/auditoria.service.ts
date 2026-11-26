import { Injectable } from '@nestjs/common';
import { Prisma, type TipoAtor } from '../generated/prisma/client.js';
import type { AlteracaoAuditada, Ator, ContextoRequisicao } from '../common/contexto/contexto.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface EntradaAuditoria {
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  oficinaId?: string | null;
  atorTipo: TipoAtor;
  atorId?: string | null;
  atorNome?: string | null;
  antes?: unknown;
  depois?: unknown;
  motivo?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  origem?: string | null;
}

const NOMES_OPERACAO: Record<string, string> = {
  create: 'CRIADO',
  createMany: 'CRIADOS',
  createManyAndReturn: 'CRIADOS',
  update: 'ATUALIZADO',
  updateMany: 'ATUALIZADOS',
  updateManyAndReturn: 'ATUALIZADOS',
  upsert: 'SALVO',
  delete: 'EXCLUIDO',
  deleteMany: 'EXCLUIDOS',
};

/** Nome padrão da ação: User + update → USER_ATUALIZADO. */
export function acaoPadrao(entidade: string, operacao: string): string {
  const nome = entidade.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  return `${nome}_${NOMES_OPERACAO[operacao] ?? operacao.toUpperCase()}`;
}

export function dadosDoAtor(
  ator: Ator | undefined,
): Pick<EntradaAuditoria, 'atorTipo' | 'atorId' | 'atorNome' | 'oficinaId'> {
  if (!ator) return { atorTipo: 'SISTEMA', atorId: null, atorNome: null, oficinaId: null };
  return {
    atorTipo: ator.tipo,
    atorId: ator.id,
    atorNome: ator.nome,
    oficinaId: ator.tipo === 'USUARIO' || ator.tipo === 'SUPORTE' ? ator.oficinaId : null,
  };
}

const json = (v: unknown) =>
  v === undefined || v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

/**
 * AuditLog (seção 9). A tabela é somente inserção (trigger + usuário de banco sem UPDATE/
 * DELETE); aqui só existe `create`. Alterações de dados são registradas pela extensão do
 * Prisma na mesma transação; este service grava os eventos avulsos (login, exportação...).
 * Se gravar falhar, o erro sobe: nada passa despercebido.
 */
@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  dadosDoLog(entrada: EntradaAuditoria): Prisma.AuditLogUncheckedCreateInput {
    return {
      ...entrada,
      antes: json(entrada.antes),
      depois: json(entrada.depois),
      motivo: entrada.motivo?.slice(0, 1000) ?? null,
    };
  }

  async gravar(entrada: EntradaAuditoria): Promise<void> {
    await this.prisma.auditLog.create({ data: this.dadosDoLog(entrada) });
  }

  entradaDeAlteracao(
    alteracao: AlteracaoAuditada,
    contexto: Partial<ContextoRequisicao>,
    extra: { acao?: string; entidade?: string; motivo?: string | null } = {},
  ): EntradaAuditoria {
    const ator = dadosDoAtor(contexto.ator);
    return {
      ...ator,
      oficinaId: alteracao.oficinaId ?? ator.oficinaId,
      // O nome da ação vale para a entidade principal; efeitos colaterais usam o nome padrão.
      acao:
        extra.acao && (!extra.entidade || extra.entidade === alteracao.entidade)
          ? extra.acao
          : acaoPadrao(alteracao.entidade, alteracao.operacao),
      entidade: alteracao.entidade,
      entidadeId: alteracao.entidadeId,
      antes: alteracao.antes,
      depois: alteracao.depois,
      motivo: extra.motivo ?? null,
      ip: contexto.ip ?? null,
      userAgent: contexto.userAgent ?? null,
      origem: contexto.origem ?? null,
    };
  }
}
