import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configurarApp, configurarSwagger } from './setup-app.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configurarApp(app);
  configurarSwagger(app);

  const porta = app.get(ConfigService).getOrThrow<number>('PORT');
  await app.listen(porta);
  Logger.log(`API em http://localhost:${porta} — Swagger em /docs`, 'Bootstrap');
}

await bootstrap();
