import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { criarApp, criarCenario, criarPrisma, SENHA, type Cenario } from './helpers.js';

describe('Limites de login (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  const original = { ip: process.env.RATE_LIMIT_LOGIN, conta: process.env.LOGIN_MAX_FALHAS_CONTA };

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
  });

  afterAll(async () => {
    process.env.RATE_LIMIT_LOGIN = original.ip;
    process.env.LOGIN_MAX_FALHAS_CONTA = original.conta;
    await prisma.$disconnect();
    await app.close();
  });

  const login = (email: string, senha = 'errada') =>
    request(app.getHttpServer()).post('/auth/oficina/login').send({ email, senha });

  it('por conta: bloqueia mesmo a senha certa depois de N falhas, e libera com o tempo', async () => {
    process.env.LOGIN_MAX_FALHAS_CONTA = '4';
    try {
      const email = c.a.mecanicoLogs.email;
      for (let i = 0; i < 4; i++) await login(email).expect(401);
      const r = await login(email, SENHA).expect(429);
      expect(r.body).toMatchObject({ codigo: 'CONTA_BLOQUEADA_TEMPORARIAMENTE' });
      expect(r.body.mensagem).toMatch(/15 minutos/);

      // Com um limite maior (equivale às falhas terem saído da janela de 15 min), entra.
      process.env.LOGIN_MAX_FALHAS_CONTA = '100';
      await login(email, SENHA).expect(200);
    } finally {
      process.env.LOGIN_MAX_FALHAS_CONTA = original.conta;
    }
  });

  it('o sucesso zera a contagem da conta', async () => {
    process.env.LOGIN_MAX_FALHAS_CONTA = '3';
    try {
      const email = c.a.mecanicoGerente.email;
      await login(email).expect(401);
      await login(email).expect(401);
      await login(email, SENHA).expect(200);
      await login(email).expect(401);
      await login(email).expect(401);
      await login(email, SENHA).expect(200); // só 2 falhas desde o último sucesso
    } finally {
      process.env.LOGIN_MAX_FALHAS_CONTA = original.conta;
    }
  });

  it('por IP: 429 depois do limite de tentativas', async () => {
    // App novo: o contador por IP fica em memória e os outros testes já o usaram.
    const isolado = await criarApp();
    process.env.RATE_LIMIT_LOGIN = '3';
    try {
      const email = `brute-${randomUUID().slice(0, 8)}@teste.local`;
      const tentar = () =>
        request(isolado.getHttpServer())
          .post('/auth/oficina/login')
          .send({ email, senha: 'errada' });
      for (let i = 0; i < 3; i++) await tentar().expect(401);
      const bloqueado = await tentar().expect(429);
      expect(bloqueado.body.mensagem).toMatch(/Muitas tentativas/);
    } finally {
      process.env.RATE_LIMIT_LOGIN = '10000';
      await isolado.close();
    }
  });
});
