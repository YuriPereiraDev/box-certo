import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { catchError, concatMap, from, Observable, throwError } from 'rxjs';
import { contextoAtual } from '../common/contexto/contexto.js';
import {
  CHAVE_AUDITAR,
  CHAVE_SEM_AUDITORIA_REQUISICAO,
  type OpcoesAuditar,
} from './auditoria.decorators.js';
import { AuditoriaService, dadosDoAtor } from './auditoria.service.js';

const METODOS_DE_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Interceptor global de auditoria. Ao fim de cada requisição grava:
 * - uma linha por alteração capturada pela extensão do Prisma (com antes/depois);
 * - se a requisição de escrita não alterou nada no banco, uma linha da própria ação.
 * As alterações são gravadas mesmo se o handler falhar depois de escrever no banco.
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

    const finalizar = async (resultado?: unknown) => {
      const contexto = contextoAtual();
      if (!contexto) return;
      const body = req.body as { motivo?: unknown } | undefined;
      const motivo = typeof body?.motivo === 'string' ? body.motivo : null;
      const houveAlteracao = contexto.alteracoes.length > 0;

      await this.auditoria.gravarAlteracoes(contexto, {
        acao: opcoes?.acao,
        entidade: opcoes?.entidade,
        motivo,
      });

      if (
        !houveAlteracao &&
        !semRequisicao &&
        resultado !== undefined &&
        METODOS_DE_ESCRITA.has(req.method)
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

    return next.handle().pipe(
      concatMap((resultado: unknown) => from(finalizar(resultado ?? null).then(() => resultado))),
      catchError((erro: unknown) =>
        from(finalizar()).pipe(concatMap(() => throwError(() => erro))),
      ),
    );
  }
}
