import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AtoresService } from '../../auth/atores.service.js';
import { TokensService } from '../../auth/tokens.service.js';
import { contextoAtual } from '../contexto/contexto.js';
import { CHAVE_PUBLICO, type RequisicaoAutenticada } from './decorators.js';

/**
 * Guard global de autenticação: valida o JWT de acesso, recarrega o ator do banco
 * (conta ativa, oficina não suspensa) e o coloca na requisição e no contexto.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly atores: AtoresService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest<Request & RequisicaoAutenticada>();
    const [esquema, token] = (req.header('authorization') ?? '').split(' ');
    if (esquema?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Faça login para continuar');
    }

    const payload = await this.tokens.verificarAcesso(token);
    const ator = await this.atores.carregar(payload.tipo, payload.sub);
    if (ator.tipo === 'USUARIO' && ator.oficinaId !== payload.oficinaId) {
      throw new UnauthorizedException('Token inválido');
    }

    req.ator = ator;
    const contexto = contextoAtual();
    if (contexto) contexto.ator = ator;
    return true;
  }
}
