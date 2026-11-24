import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validarEnv } from './common/config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // .env local da API tem prioridade sobre o .env da raiz do monorepo.
      envFilePath: ['.env', '../../.env'],
      validate: validarEnv,
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
