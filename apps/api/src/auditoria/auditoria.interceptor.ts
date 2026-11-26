import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { concatMap, from, Observable } from 'rxjs';
import { contextoAtual } from '../common/contexto/contexto.js';
import {
  CHAVE_AUDITAR,
  CHAVE_SEM_AUDITORIA_REQUISICAO,
  type OpcoesAuditar,
} from './auditoria.decorators.js';
import { AuditoriaService, dadosDoAtor } from './auditoria.service.js';

const METODOS_DE_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Interceptor global de auditoria.
 * - Antes do handler, guarda no contexto o nome da ação (@Auditar) e o motivo do corpo: a
 *   extensão do Prisma usa isso ao gravar cada alteração na mesma transação.
 * - Se a requisição de escrita não alterou nada no banco, grava uma linha da própria ação
 *   (também em leituras marcadas com @Auditar, como exportações — seção 9).
 */
@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  constructor(
    private readonly auditoria: AuditoriaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const alvos = [ctx.getHandler(), ctx.getClass()];
    const opcoes = this.reflector.getAllAndOverride<OpcoesAuditar | undefined>(
      CHAVE_AUDITAR,
      alvos,
    );
    const semRequisicao = this.reflector.getAllAndOverride<boolean>(
      CHAVE_SEM_AUDITORIA_REQUISICAO,
      alvos,
    );

    const body = req.body as { motivo?: unknown } | undefined;
    const motivo = typeof body?.motivo === 'string' ? body.motivo : null;
    const inicio = contextoAtual();
    if (inicio) inicio.auditoria = { acao: opcoes?.acao, entidade: opcoes?.entidade, motivo };

    const finalizar = async (resultado: unknown) => {
      const contexto = contextoAtual();
      if (!contexto) return;
      const houveAlteracao = contexto.alteracoes.length > 0;

      if (
        !houveAlteracao &&
        !semRequisicao &&
        resultado !== undefined &&
        (METODOS_DE_ESCRITA.has(req.method) || opcoes !== undefined)
      ) {
        const params = req.params as Record<string, string | undefined>;
        const rota = (req.route as { path?: string } | undefined)?.path ?? req.path;
        const idResultado: unknown =
          resultado && typeof resultado === 'object' ? Reflect.get(resultado, 'id') : null;
        await this.auditoria.gravar({
          ...dadosDoAtor(contexto.ator),
          acao: opcoes?.acao ?? `${req.method} ${rota}`,
          entidade: opcoes?.entidade ?? ctx.getClass().name.replace(/Controller$/, ''),
          entidadeId: params.id ?? (typeof idResultado === 'string' ? idResultado : null),
          motivo,
          ip: contexto.ip,
          userAgent: contexto.userAgent,
          origem: contexto.origem,
        });
      }
    };

    return next
      .handle()
      .pipe(
        concatMap((resultado: unknown) => from(finalizar(resultado ?? null).then(() => resultado))),
      );
  }
}
