import { createHmac, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { TipoAtorAutenticado } from '../common/contexto/contexto.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const DURACAO_ACESSO_SEGUNDOS = 15 * 60;
export const DURACAO_REFRESH_DIAS = 30;
export const DURACAO_CONFIG_2FA_SEGUNDOS = 10 * 60;

/** Conteúdo do JWT de acesso. Permissões não vão no token: são lidas do banco a cada requisição. */
export interface PayloadAcesso {
  sub: string;
  tipo: TipoAtorAutenticado;
  oficinaId?: string;
  /** Modo suporte: id da SessaoSuporte. */
  sid?: string;
  typ: 'acesso';
}

/** Token curto usado só para configurar o 2FA de um admin no primeiro login. */
export interface PayloadConfig2fa {
  sub: string;
  typ: 'config-2fa';
}

export interface ParDeTokens {
  accessToken: string;
  refreshToken: string;
  expiraEmSegundos: number;
}

interface InfoCliente {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class TokensService {
  private readonly segredoRefresh: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.segredoRefresh = config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  /** Só o HMAC do refresh token é salvo no banco. */
  hashRefresh(token: string): string {
    return createHmac('sha256', this.segredoRefresh).update(token).digest('hex');
  }

  async emitirPar(
    ator: { tipo: TipoAtorAutenticado; id: string; oficinaId?: string },
    info: InfoCliente,
  ): Promise<{ par: ParDeTokens; refreshId: string }> {
    const payload: PayloadAcesso = { sub: ator.id, tipo: ator.tipo, typ: 'acesso' };
    if (ator.oficinaId) payload.oficinaId = ator.oficinaId;
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: DURACAO_ACESSO_SEGUNDOS });

    const refreshToken = randomBytes(48).toString('base64url');
    const registro = await this.prisma.refreshToken.create({
      data: {
        atorTipo: ator.tipo,
        atorId: ator.id,
        hash: this.hashRefresh(refreshToken),
        expiraEm: new Date(Date.now() + DURACAO_REFRESH_DIAS * 24 * 60 * 60 * 1000),
        ip: info.ip,
        userAgent: info.userAgent,
      },
    });
    return {
      par: { accessToken, refreshToken, expiraEmSegundos: DURACAO_ACESSO_SEGUNDOS },
      refreshId: registro.id,
    };
  }

  /** Token do modo suporte: sem refresh, vale até o fim da sessão de suporte. */
  async emitirSuporte(adminId: string, oficinaId: string, sessaoId: string, expiraEm: Date) {
    const payload: PayloadAcesso = {
      sub: adminId,
      tipo: 'SUPORTE',
      oficinaId,
      sid: sessaoId,
      typ: 'acesso',
    };
    const segundos = Math.max(1, Math.floor((expiraEm.getTime() - Date.now()) / 1000));
    return this.jwt.signAsync(payload, { expiresIn: segundos });
  }

  /** Encerra todas as sessões (refresh tokens) de um ator. */
  async revogarTodos(tipo: TipoAtorAutenticado, atorId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { atorTipo: tipo, atorId, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
  }

  async verificarAcesso(token: string): Promise<PayloadAcesso> {
    const payload = await this.verificar<PayloadAcesso | PayloadConfig2fa>(token);
    if (payload.typ !== 'acesso') throw new UnauthorizedException('Token inválido');
    return payload;
  }

  async emitirConfig2fa(adminId: string): Promise<string> {
    const payload: PayloadConfig2fa = { sub: adminId, typ: 'config-2fa' };
    return this.jwt.signAsync(payload, { expiresIn: DURACAO_CONFIG_2FA_SEGUNDOS });
  }

  async verificarConfig2fa(token: string): Promise<PayloadConfig2fa> {
    const payload = await this.verificar<PayloadAcesso | PayloadConfig2fa>(token);
    if (payload.typ !== 'config-2fa') throw new UnauthorizedException('Token inválido');
    return payload;
  }

  private async verificar<T extends object>(token: string): Promise<T> {
    try {
      return await this.jwt.verifyAsync<T>(token);
    } catch {
      throw new UnauthorizedException('Sessão expirada ou token inválido');
    }
  }
}
