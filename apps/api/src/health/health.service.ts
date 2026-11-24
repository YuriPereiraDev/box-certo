import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type EstadoServico = 'up' | 'down';

export interface ResultadoHealth {
  status: 'ok' | 'erro';
  timestamp: string;
  uptimeSegundos: number;
  servicos: { banco: EstadoServico };
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async verificar(): Promise<ResultadoHealth> {
    const banco = await this.verificarBanco();
    return {
      status: banco === 'up' ? 'ok' : 'erro',
      timestamp: new Date().toISOString(),
      uptimeSegundos: Math.round(process.uptime()),
      servicos: { banco },
    };
  }

  private async verificarBanco(): Promise<EstadoServico> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }
}
