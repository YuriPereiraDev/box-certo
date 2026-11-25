import { SetMetadata } from '@nestjs/common';

export const CHAVE_AUDITAR = 'auditoria:acao';
export const CHAVE_SEM_AUDITORIA_REQUISICAO = 'auditoria:sem-requisicao';

export interface OpcoesAuditar {
  /** Nome da ação no log, ex.: USUARIO_DADOS_ATUALIZADOS. */
  acao: string;
  /** Entidade usada quando a ação não altera nenhum registro. */
  entidade?: string;
}

/** Dá nome à ação registrada no AuditLog. */
export const Auditar = (opcoes: OpcoesAuditar) => SetMetadata(CHAVE_AUDITAR, opcoes);

/**
 * A rota grava os próprios eventos de auditoria (ex.: login). O interceptor não cria
 * a linha genérica da requisição, mas continua gravando as alterações capturadas no banco.
 */
export const SemAuditoriaDeRequisicao = () => SetMetadata(CHAVE_SEM_AUDITORIA_REQUISICAO, true);
