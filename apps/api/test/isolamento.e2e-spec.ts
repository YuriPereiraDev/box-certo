import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  criarApp,
  criarCenario,
  criarPrisma,
  tokenAdmin,
  tokenCliente,
  tokenOficina,
  type Cenario,
} from './helpers.js';

/** Seção 5: um usuário da oficina A não lê nem altera nada da oficina B. */
describe('Isolamento entre oficinas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  let masterA: string;
  let masterB: string;

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    masterA = await tokenOficina(app, c.a.master.email);
    masterB = await tokenOficina(app, c.b.master.email);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('lista só os usuários da própria oficina', async () => {
    const res = await http().get('/oficina/usuarios').auth(masterA, { type: 'bearer' }).expect(200);
    const usuarios = res.body as { id: string; oficinaId: string }[];
    expect(usuarios).toHaveLength(4);
    expect(usuarios.every((u) => u.oficinaId === c.a.id)).toBe(true);
    expect(usuarios.map((u) => u.id)).not.toContain(c.b.master.id);
  });

  it('GET de usuário de outra oficina retorna 404', async () => {
    await http()
      .get(`/oficina/usuarios/${c.b.mecanico.id}`)
      .auth(masterA, { type: 'bearer' })
      .expect(404);
  });

  it('PATCH em usuário de outra oficina retorna 404 e não altera nada', async () => {
    const antes = await prisma.user.findUniqueOrThrow({ where: { id: c.b.mecanico.id } });
    await http()
      .patch(`/oficina/usuarios/${c.b.mecanico.id}`)
      .auth(masterA, { type: 'bearer' })
      .send({ nome: 'Invadido' })
      .expect(404);
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: c.b.mecanico.id } });
    expect(depois.nome).toBe(antes.nome);
    expect(depois.updatedAt).toEqual(antes.updatedAt);
  });

  it('oficinaId no corpo é recusado (vem sempre do token)', async () => {
    await http()
      .patch(`/oficina/usuarios/${c.a.mecanico.id}`)
      .auth(masterA, { type: 'bearer' })
      .send({ nome: 'Teste', oficinaId: c.b.id })
      .expect(400);
  });

  it('logs da oficina mostram só eventos da própria oficina', async () => {
    // Gera um evento na oficina B.
    await http()
      .patch(`/oficina/usuarios/${c.b.mecanico.id}`)
      .auth(masterB, { type: 'bearer' })
      .send({ telefone: '11900000000' })
      .expect(200);

    const res = await http()
      .get('/oficina/logs?limite=200')
      .auth(masterA, { type: 'bearer' })
      .expect(200);
    const logs = (res.body as { itens: { oficinaId: string | null; entidadeId: string | null }[] })
      .itens;
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.oficinaId === c.a.id)).toBe(true);
    expect(logs.map((l) => l.entidadeId)).not.toContain(c.b.mecanico.id);
  });

  it('log de outra oficina não aparece nem filtrando pelo id dela', async () => {
    const res = await http()
      .get(`/oficina/logs?entidadeId=${c.b.mecanico.id}`)
      .auth(masterA, { type: 'bearer' })
      .expect(200);
    expect((res.body as { total: number }).total).toBe(0);
  });

  it('cliente vê só as oficinas às quais está vinculado', async () => {
    const token = await tokenCliente(app, c.cliente.email);
    const res = await http().get('/cliente/oficinas').auth(token, { type: 'bearer' }).expect(200);
    expect((res.body as { id: string }[]).map((o) => o.id)).toEqual([c.a.id]);
  });

  describe('cada tipo de conta só acessa o próprio prefixo', () => {
    it('cliente não acessa /oficina', async () => {
      const token = await tokenCliente(app, c.cliente.cpf);
      await http().get('/oficina/usuarios').auth(token, { type: 'bearer' }).expect(403);
    });

    it('usuário da oficina não acessa /plataforma', async () => {
      await http().get('/plataforma/logs').auth(masterA, { type: 'bearer' }).expect(403);
      await http().get('/plataforma/admins').auth(masterA, { type: 'bearer' }).expect(403);
    });

    it('admin da plataforma não usa rotas /oficina sem modo suporte', async () => {
      const token = await tokenAdmin(app, c.dono);
      await http().get('/oficina/usuarios').auth(token, { type: 'bearer' }).expect(403);
    });

    it('usuário da oficina não acessa /cliente', async () => {
      await http().get('/cliente/oficinas').auth(masterA, { type: 'bearer' }).expect(403);
    });
  });
});
