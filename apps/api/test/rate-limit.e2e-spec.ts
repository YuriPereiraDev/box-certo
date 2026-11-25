import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { criarApp } from './helpers.js';

describe('Rate limit do login (e2e)', () => {
  let app: INestApplication<App>;
  let limiteOriginal: string | undefined;

  beforeAll(async () => {
    limiteOriginal = process.env.RATE_LIMIT_LOGIN;
    process.env.RATE_LIMIT_LOGIN = '3';
    app = await criarApp();
  });

  afterAll(async () => {
    process.env.RATE_LIMIT_LOGIN = limiteOriginal;
    await app.close();
  });

  it('bloqueia com 429 depois do limite de tentativas', async () => {
    const tentar = () =>
      request(app.getHttpServer())
        .post('/auth/oficina/login')
        .send({ email: 'brute@teste.local', senha: 'x' });
    for (let i = 0; i < 3; i++) await tentar().expect(401);
    const bloqueado = await tentar().expect(429);
    expect(bloqueado.body.mensagem).toMatch(/Muitas tentativas/);
  });
});
