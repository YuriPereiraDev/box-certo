import type { NextFunction, Request, Response } from 'express';
import { contextoRequisicao } from './contexto.js';

export const ORIGENS_VALIDAS = ['APP_ANDROID', 'APP_IOS', 'DESKTOP', 'WEB'] as const;

/** Abre o contexto da requisição (ator, IP, user agent, origem) para auditoria e tenant. */
export function middlewareContexto(req: Request, _res: Response, next: NextFunction): void {
  const origemHeader = req.header('x-origem')?.trim().toUpperCase();
  const origem = (ORIGENS_VALIDAS as readonly string[]).includes(origemHeader ?? '')
    ? origemHeader
    : undefined;

  contextoRequisicao.run(
    {
      ip: req.ip,
      userAgent: req.header('user-agent')?.slice(0, 500),
      origem,
      alteracoes: [],
    },
    () => next(),
  );
}
