import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { middlewareContexto } from './common/contexto/contexto.middleware.js';

/** Configuração compartilhada entre main.ts e os testes e2e. */
export function configurarApp(app: INestApplication): void {
  const config = app.get(ConfigService);

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
