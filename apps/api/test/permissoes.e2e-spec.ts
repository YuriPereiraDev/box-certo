import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  criarApp,
  criarCenario,
  criarPrisma,
  tokenAdmin,
  tokenOficina,
  type Cenario,
} from './helpers.js';

/** Seção 4: perfis e permissões são checados na API. */
describe('Permissões (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    tokens.master = await tokenOficina(app, c.a.master.email);
    tokens.mecanico = await tokenOficina(app, c.a.mecanico.email);
    tokens.gerente = await tokenOficina(app, c.a.mecanicoGerente.email);
    tokens.logs = await tokenOficina(app, c.a.mecanicoLogs.email);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('oficina', () => {
    it('mecânico comum não lista usuários (403)', async () => {
      await http().get('/oficina/usuarios').auth(tokens.mecanico, { type: 'bearer' }).expect(403);
    });

    it('mecânico com GERENTE lista usuários', async () => {
      await http().get('/oficina/usuarios').auth(tokens.gerente, { type: 'bearer' }).expect(200);
    });

    it('MASTER passa em qualquer permissão', async () => {
      await http().get('/oficina/usuarios').auth(tokens.master, { type: 'bearer' }).expect(200);
      await http().get('/oficina/logs').auth(tokens.master, { type: 'bearer' }).expect(200);
    });

    it('logs exigem VER_LOGS', async () => {
      await http().get('/oficina/logs').auth(tokens.mecanico, { type: 'bearer' }).expect(403);
      await http().get('/oficina/logs').auth(tokens.gerente, { type: 'bearer' }).expect(403);
      await http().get('/oficina/logs').auth(tokens.logs, { type: 'bearer' }).expect(200);
    });

    it('só MASTER edita usuário, mesmo com GERENTE', async () => {
      for (const t of [tokens.mecanico, tokens.gerente]) {
        await http()
          .patch(`/oficina/usuarios/${c.a.mecanico.id}`)
          .auth(t, { type: 'bearer' })
          .send({ nome: 'X' })
          .expect(403);
      }
      await http()
        .patch(`/oficina/usuarios/${c.a.mecanico.id}`)
        .auth(tokens.master, { type: 'bearer' })
        .send({ nome: 'Mecânico renomeado' })
        .expect(200);
    });

    it('permissão removida vale na hora (não depende do token)', async () => {
      const id = c.a.mecanicoGerente.id;
      await prisma.user.update({ where: { id }, data: { permissoes: [] } });
      await http().get('/oficina/usuarios').auth(tokens.gerente, { type: 'bearer' }).expect(403);
      await prisma.user.update({ where: { id }, data: { permissoes: ['GERENTE'] } });
    });

    it('usuário desativado perde o acesso na hora', async () => {
      const id = c.a.mecanicoLogs.id;
      await prisma.user.update({ where: { id }, data: { ativo: false } });
      await http().get('/auth/me').auth(tokens.logs, { type: 'bearer' }).expect(401);
      await prisma.user.update({ where: { id }, data: { ativo: true } });
    });

    it('respostas nunca trazem senhaHash', async () => {
      const res = await http().get('/oficina/usuarios').auth(tokens.master, { type: 'bearer' });
      expect(JSON.stringify(res.body)).not.toContain('senhaHash');
      const me = await http().get('/auth/me').auth(tokens.master, { type: 'bearer' });
      expect(JSON.stringify(me.body)).not.toContain('senhaHash');
    });
  });

  describe('plataforma', () => {
    it('admin sem GESTAO_ADMINS não lista admins', async () => {
      const t = await tokenAdmin(app, c.adminSemPermissao);
      await http().get('/plataforma/admins').auth(t, { type: 'bearer' }).expect(403);
    });

    it('admin com GESTAO_ADMINS lista admins', async () => {
      const t = await tokenAdmin(app, c.adminGestaoAdmins);
      await http().get('/plataforma/admins').auth(t, { type: 'bearer' }).expect(200);
    });

    it('o dono passa em tudo e a resposta não traz segredos', async () => {
      const t = await tokenAdmin(app, c.dono);
      const res = await http().get('/plataforma/admins').auth(t, { type: 'bearer' }).expect(200);
      const corpo = JSON.stringify(res.body);
      expect(corpo).not.toContain('senhaHash');
      expect(corpo).not.toContain('totpSecret');
    });
  });

  it('sem token: 401', async () => {
    await http().get('/oficina/usuarios').expect(401);
    await http().get('/auth/me').auth('token-invalido', { type: 'bearer' }).expect(401);
  });
});
