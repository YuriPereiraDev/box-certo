import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import { ErroSemOficinaNoContexto } from '../../prisma/extensao-tenant.js';

export interface CorpoErro {
  statusCode: number;
  erro: string;
  mensagem: string | string[];
  codigo?: string;
  caminho: string;
  timestamp: string;
  [extra: string]: unknown;
}

const NOMES: Record<number, string> = {
  400: 'Requisição inválida',
  401: 'Não autenticado',
  403: 'Acesso negado',
  404: 'Não encontrado',
  409: 'Conflito',
  422: 'Dados inválidos',
  429: 'Muitas requisições',
  500: 'Erro interno',
  503: 'Serviço indisponível',
};

/** Converte qualquer erro em uma resposta padronizada, sem vazar detalhes internos. */
@Catch()
export class ErrosFilter implements ExceptionFilter {
  private readonly logger = new Logger('Erros');

  catch(erro: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const { status, mensagem, extras } = this.traduzir(erro);

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl}`,
        erro instanceof Error ? erro.stack : erro,
      );
    }

    const corpo: CorpoErro = {
      statusCode: status,
      erro: NOMES[status] ?? 'Erro',
      mensagem,
      ...extras,
      caminho: req.originalUrl,
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(corpo);
  }

  private traduzir(erro: unknown): {
    status: number;
    mensagem: string | string[];
    extras: Record<string, unknown>;
  } {
    if (erro instanceof HttpException) {
      const status = erro.getStatus();
      const resposta = erro.getResponse();
      // Só o limite genérico do throttler ganha a mensagem padrão; bloqueios com código mantêm a sua.
      if (erro instanceof ThrottlerException) {
        return {
          status,
          mensagem: 'Muitas tentativas. Aguarde um pouco e tente novamente.',
          extras: {},
        };
      }
      if (typeof resposta === 'string') return { status, mensagem: resposta, extras: {} };
      const {
        mensagem,
        message,
        statusCode: _s,
        error: _e,
        ...extras
      } = resposta as Record<string, unknown>;
      return {
        status,
        mensagem: (mensagem ?? message ?? erro.message) as string | string[],
        extras,
      };
    }

    if (erro instanceof Prisma.PrismaClientKnownRequestError) {
      switch (erro.code) {
        case 'P2025':
          return { status: 404, mensagem: 'Registro não encontrado', extras: {} };
        case 'P2002':
          return {
            status: 409,
            mensagem: 'Já existe um registro com estes dados',
            extras: { campos: (erro.meta as { target?: unknown } | undefined)?.target },
          };
        case 'P2003':
          return { status: 400, mensagem: 'Referência a um registro que não existe', extras: {} };
      }
    }

    if (erro instanceof ErroSemOficinaNoContexto) {
      return { status: 403, mensagem: 'Acesso negado', extras: {} };
    }

    return { status: 500, mensagem: 'Erro interno. Tente novamente em instantes.', extras: {} };
  }
}
