import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { BancoService } from '../src/prisma/banco.service.js';
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

  describe('AuditLog é somente inserção (duas camadas)', () => {
    const negado = /permission denied|permissão negada|somente inserção/;

    it('o usuário da API não altera, apaga, trunca nem remove o gatilho', async () => {
      const log = await prisma.auditLog.findFirstOrThrow({ where: { atorId: c.a.master.id } });
      await expect(
        prisma.$executeRaw`UPDATE "AuditLog" SET acao = 'ADULTERADO' WHERE id = ${log.id}`,
      ).rejects.toThrow(negado);
      await expect(prisma.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${log.id}`).rejects.toThrow(
        negado,
      );
      await expect(prisma.$executeRaw`TRUNCATE "AuditLog"`).rejects.toThrow(negado);
      await expect(
        prisma.$executeRaw`ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_bloqueia_update_delete`,
      ).rejects.toThrow(/owner|dono|must be/);
      const aindaLa = await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } });
      expect(aindaLa.acao).toBe(log.acao);
    });

    it('nem o dono do banco consegue apagar (o gatilho barra)', async () => {
      const dono = new PrismaClient({
        adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_MIGRACAO! }),
      });
      try {
        const log = await dono.auditLog.findFirstOrThrow({ where: { atorId: c.a.master.id } });
        await expect(dono.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${log.id}`).rejects.toThrow(
          /somente inserção/,
        );
      } finally {
        await dono.$disconnect();
      }
    });

    it('nenhuma tabela aceita DELETE pelo usuário da API (exclusões são lógicas)', async () => {
      await expect(
        prisma.$executeRaw`DELETE FROM "User" WHERE id = ${c.a.mecanico.id}`,
      ).rejects.toThrow(negado);
      await expect(prisma.$executeRaw`DELETE FROM "Oficina" WHERE id = ${c.b.id}`).rejects.toThrow(
        negado,
      );
      expect(await prisma.user.findUnique({ where: { id: c.a.mecanico.id } })).not.toBeNull();
    });
  });

  it('se o log falhar, a alteração é desfeita (mesma transação)', async () => {
    const antes = await prisma.user.findUniqueOrThrow({ where: { id: c.a.mecanicoLogs.id } });
    const banco = app.get(BancoService);
    await expect(
      banco.sistema.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: c.a.mecanicoLogs.id },
          data: { nome: 'Não deve ficar' },
        });
        // O log da linha acima já está na transação; uma falha logo depois desfaz os dois.
        throw new Error('falha simulada');
      }),
    ).rejects.toThrow('falha simulada');
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: c.a.mecanicoLogs.id } });
    expect(depois.nome).toBe(antes.nome);
    const logs = await prisma.auditLog.count({
      where: {
        entidadeId: c.a.mecanicoLogs.id,
        depois: { path: ['nome'], equals: 'Não deve ficar' },
      },
    });
    expect(logs).toBe(0);
  });

  it('alteração fora de $transaction grava o log junto (atômico)', async () => {
    const banco = app.get(BancoService);
    await banco.sistema.user.update({
      where: { id: c.a.mecanicoLogs.id },
      data: { telefone: '11955554444' },
    });
    const log = await prisma.auditLog.findFirst({
      where: {
        entidadeId: c.a.mecanicoLogs.id,
        depois: { path: ['telefone'], equals: '11955554444' },
      },
    });
    expect(log).toMatchObject({ atorTipo: 'SISTEMA', acao: 'USER_ATUALIZADO' });
  });
});
