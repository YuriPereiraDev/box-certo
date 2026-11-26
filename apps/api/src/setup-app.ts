import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Application } from 'express';
import helmet from 'helmet';
import { middlewareContexto } from './common/contexto/contexto.middleware.js';

/** Configuração compartilhada entre main.ts e os testes e2e. */
export function configurarApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  // Atrás de proxy reverso o IP real vem no X-Forwarded-For (rate limit e auditoria dependem disso).
  const proxy = config.get<string>('TRUST_PROXY')?.trim();
  if (proxy && proxy !== 'false') {
    const valor = proxy === 'true' ? true : /^\d+$/.test(proxy) ? Number(proxy) : proxy;
    (app.getHttpAdapter().getInstance() as Application).set('trust proxy', valor);
  }

  app.use(helmet());
  app.enableCors({
    origin: (config.get<string>('CORS_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  });
  // Contexto por requisição (ator, IP, origem) para auditoria e filtro de oficina.
  app.use(middlewareContexto);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Campos não previstos (ex.: oficinaId no corpo) geram 400.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}

export function configurarSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Box Certo API')
    .setDescription(
      'API do Box Certo — SaaS para oficinas mecânicas.\n\n' +
        'Prefixos: `/plataforma/*` (admins), `/oficina/*` (usuários da oficina), ' +
        '`/cliente/*` (clientes), `/publico/*` (sem login). ' +
        'Envie o header `X-Origem` (APP_ANDROID, APP_IOS, DESKTOP, WEB) para a auditoria.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
}
