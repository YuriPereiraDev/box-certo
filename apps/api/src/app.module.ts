import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgendamentosModule } from './agendamentos/agendamentos.module.js';
import { ArquivosModule } from './arquivos/arquivos.module.js';
import { OrdensServicoModule } from './ordens-servico/ordens-servico.module.js';
import { AuditoriaInterceptor } from './auditoria/auditoria.interceptor.js';
import { AuditoriaModule } from './auditoria/auditoria.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ClientesModule } from './clientes/clientes.module.js';
import { ConvitesModule } from './convites/convites.module.js';
import { AcessoGuard } from './common/auth/acesso.guard.js';
import { AuthGuard } from './common/auth/auth.guard.js';
import { validarEnv } from './common/config/env.validation.js';
import { ErrosFilter } from './common/filtros/erros.filter.js';
import { HealthModule } from './health/health.module.js';
import { OficinasModule } from './oficinas/oficinas.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TabelaPrecosModule } from './tabela-precos/tabela-precos.module.js';
import { UsuariosModule } from './usuarios/usuarios.module.js';
import { VeiculosModule } from './veiculos/veiculos.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // .env local da API tem prioridade sobre o .env da raiz do monorepo.
      envFilePath: ['.env', '../../.env'],
      validate: validarEnv,
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        // Limite geral por IP (RATE_LIMIT_GERAL por minuto). Login tem limite próprio.
        { name: 'default', ttl: 60_000, limit: () => Number(process.env.RATE_LIMIT_GERAL ?? 300) },
      ],
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    UsuariosModule,
    AuditoriaModule,
    PlatformModule,
    ClientesModule,
    OficinasModule,
    TabelaPrecosModule,
    ConvitesModule,
    VeiculosModule,
    AgendamentosModule,
    ArquivosModule,
    OrdensServicoModule,
  ],
  providers: [
    // A ordem importa: rate limit → autenticação → autorização.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AcessoGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditoriaInterceptor },
    { provide: APP_FILTER, useClass: ErrosFilter },
  ],
})
export class AppModule {}
