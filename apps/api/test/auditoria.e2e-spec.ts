import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { criarApp, criarCenario, criarPrisma, tokenOficina, type Cenario } from './helpers.js';

/** Seção 9: toda alteração gera AuditLog, e o log não pode ser alterado nem apagado. */
describe('Auditoria (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  let master: string;

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    master = await tokenOficina(app, c.a.master.email);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('alteração registra ator, antes/depois, motivo, IP, user agent e origem', async () => {
    await request(app.getHttpServer())
      .patch(`/oficina/usuarios/${c.a.mecanico.id}`)
      .auth(master, { type: 'bearer' })
      .set('X-Origem', 'app_android')
      .set('User-Agent', 'BoxCerto-Teste/1.0')
      .send({ nome: 'Nome Novo', motivo: 'Correção do cadastro' })
      .expect(200);

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entidade: 'User', entidadeId: c.a.mecanico.id, acao: 'USUARIO_ATUALIZADO' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).toMatchObject({
      oficinaId: c.a.id,
      atorTipo: 'USUARIO',
      atorId: c.a.master.id,
      motivo: 'Correção do cadastro',
      origem: 'APP_ANDROID',
      userAgent: 'BoxCerto-Teste/1.0',
    });
    expect(log.ip).toBeTruthy();
    expect(log.antes).toMatchObject({ nome: 'mecanico' });
    expect(log.depois).toMatchObject({ nome: 'Nome Novo' });
    expect(JSON.stringify(log)).not.toMatch(/\$argon2/); // senha nunca vai para o log
  });

  it('login com sucesso é registrado', async () => {
    const log = await prisma.auditLog.findFirst({
      where: { acao: 'LOGIN_SUCESSO', atorId: c.a.master.id },
    });
    expect(log).toMatchObject({ atorTipo: 'USUARIO', oficinaId: c.a.id });
  });

  it('o banco bloqueia UPDATE, DELETE e TRUNCATE no AuditLog', async () => {
    const log = await prisma.auditLog.findFirstOrThrow({ where: { atorId: c.a.master.id } });
    await expect(
      prisma.$executeRaw`UPDATE "AuditLog" SET acao = 'ADULTERADO' WHERE id = ${log.id}`,
    ).rejects.toThrow(/somente inserção/);
    await expect(prisma.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${log.id}`).rejects.toThrow(
      /somente inserção/,
    );
    await expect(prisma.$executeRaw`TRUNCATE "AuditLog"`).rejects.toThrow(/somente inserção/);
    const aindaLa = await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(aindaLa.acao).toBe(log.acao);
  });
});
