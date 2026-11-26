import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { dataLocal } from '../src/common/utils/datas.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { criarApp, criarPrisma } from './helpers.js';

/**
 * Critério da fase 7: os números do dashboard batem com os dados do seed.
 * Roda o seed de verdade numa oficina nova e compara com os valores do seed calculados à mão.
 */
describe('Dashboard (e2e) — números batem com o seed', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let oficinaId: string;
  const senha = process.env.SEED_SENHA_USUARIOS!;
  const nome = `Oficina Seed ${randomUUID().slice(0, 8)}`;
  const hoje = dataLocal(new Date());
  const competencia = hoje.slice(0, 7);
  const [ano, mes] = competencia.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  // Mês inteiro: as despesas recorrentes do seed vencem nos dias 5, 10, 15 e 20.
  const periodo = `de=${competencia}-01&ate=${competencia}-${ultimoDia}`;
  const t: Record<string, string> = {};

  const login = async (email: string, senhaLogin = senha) => {
    const r = await request(app.getHttpServer())
      .post('/auth/oficina/login')
      .send({ email, senha: senhaLogin, oficinaId })
      .expect(200);
    return r.body.accessToken as string;
  };

  beforeAll(async () => {
    if (!senha) throw new Error('SEED_SENHA_USUARIOS precisa estar no .env para este teste');
    execSync('npx prisma db seed', {
      stdio: 'pipe',
      env: { ...process.env, SEED_OFICINA_NOME: nome },
    });
    app = await criarApp();
    prisma = criarPrisma();
    oficinaId = (await prisma.oficina.findFirstOrThrow({ where: { nome } })).id;

    t.master = await login('master@oficina-exemplo.local');
    t.gerente = await login('mecanico1@oficina-exemplo.local'); // GERENTE, sem FINANCEIRO
    t.mecanico = await login('mecanico2@oficina-exemplo.local'); // mecânico comum
    t.financeiro = await login('financeiro@oficina-exemplo.local'); // FINANCEIRO + VER_SALARIOS
    const email = `fin-sem-salario-${randomUUID().slice(0, 6)}@teste.local`;
    await prisma.user.create({
      data: {
        oficinaId,
        nome: 'Financeiro sem salários',
        email,
        senhaHash: await argon2.hash('Senha-teste-123'),
        role: 'FINANCEIRO',
        permissoes: ['FINANCEIRO'],
      },
    });
    t.financeiroSemSalarios = await login(email, 'Senha-teste-123');
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corpo dinâmico do JSON
  const dashboard = async (token: string, extra = ''): Promise<any> =>
    (
      await http()
        .get(`/oficina/dashboard?${periodo}${extra}`)
        .auth(token, { type: 'bearer' })
        .expect(200)
    ).body;

  // Valores do seed (prisma/seed.ts), em centavos:
  // OS concluída e paga: troca de óleo 80,00 + 4 × óleo 49,90 + filtro 35,00 = 314,60
  const FATURAMENTO = 8_000 + 4 * 4_990 + 3_500;
  // Custo das peças dessa OS: 4 × 32,00 + 19,00
  const CUSTO_PECAS = 4 * 3_200 + 1_900;
  // Despesas do mês: compras do estoque + recorrentes do mês + vale + ferramentas
  const ESTOQUE = 24 * 3_200 + 6 * 1_900 + 3 * 11_000 + 10 * 1_500;
  const SALARIOS = 280_000 + 50_000;
  const DESPESAS = ESTOQUE + 450_000 + 14_990 + 89_000 + SALARIOS + 32_900;

  it('cards do master', async () => {
    const d = await dashboard(t.master);
    expect(d.cards).toMatchObject({
      faturamentoCentavos: FATURAMENTO,
      quantidadeOs: 1,
      ticketMedioCentavos: FATURAMENTO,
      descontosCentavos: 0, // o desconto da OS 2 está pendente: não conta
      aReceberCentavos: 0,
      orcamentos: {
        aprovados: { quantidade: 3, valorCentavos: FATURAMENTO },
        recusados: { quantidade: 0, valorCentavos: 0 },
        aguardandoResposta: 1,
      },
      agendamentosHoje: { total: 0 }, // seed agenda em -7, -2, +1, +1 e +3 dias
    });
  });

  it('gráficos: por mês, por mecânico e mais feitos', async () => {
    const d = await dashboard(t.master);
    const meses = d.graficos.faturamentoPorMes as { mes: string; faturamentoCentavos: number }[];
    expect(meses).toHaveLength(12);
    expect(meses.at(-1)).toEqual({
      mes: competencia,
      faturamentoCentavos: FATURAMENTO,
      quantidadeOs: 1,
    });
    expect(meses.slice(0, -1).every((m) => m.faturamentoCentavos === 0)).toBe(true);

    const porMecanico = d.graficos.porMecanico as {
      mecanico: { nome: string };
      faturamentoCentavos: number;
      osPagas: number;
      osConcluidas: number;
    }[];
    expect(porMecanico).toHaveLength(3); // master + 2 mecânicos
    expect(porMecanico[0]).toMatchObject({
      mecanico: { nome: 'Gabriel Mecânico (gerente)' },
      faturamentoCentavos: FATURAMENTO,
      osPagas: 1,
      osConcluidas: 1,
    });

    expect(d.graficos.maisFeitos.servicos).toEqual([
      {
        descricao: 'Troca de óleo e filtro',
        tipo: 'MAO_DE_OBRA',
        quantidade: 1,
        quantidadeOs: 1,
        valorCentavos: 8_000,
      },
    ]);
    expect(d.graficos.maisFeitos.pecas).toEqual([
      {
        descricao: 'Óleo 5W30 sintético (1 L)',
        tipo: 'PECA',
        quantidade: 4,
        quantidadeOs: 1,
        valorCentavos: 19_960,
      },
      {
        descricao: 'Filtro de óleo',
        tipo: 'PECA',
        quantidade: 1,
        quantidadeOs: 1,
        valorCentavos: 3_500,
      },
    ]);
  });

  it('financeiro do master: lucro = faturamento − despesas do mês', async () => {
    const d = await dashboard(t.master);
    expect(d.financeiro).toMatchObject({
      receitasCentavos: FATURAMENTO,
      despesasCentavos: DESPESAS,
      lucroCentavos: FATURAMENTO - DESPESAS,
      incluiSalarios: true,
      custoPecasVendidasCentavos: CUSTO_PECAS,
    });
    const porCategoria = Object.fromEntries(
      (d.financeiro.despesasPorCategoria as { categoria: string; totalCentavos: number }[]).map(
        (c) => [c.categoria, c.totalCentavos],
      ),
    );
    expect(porCategoria).toEqual({
      Aluguel: 450_000,
      'Salários e funcionários': SALARIOS,
      Peças: ESTOQUE,
      Energia: 89_000,
      Ferramentas: 32_900,
      Internet: 14_990,
    });
  });

  it('confere com os endpoints de despesas (mesma regra de contas a vencer)', async () => {
    const d = await dashboard(t.master);
    const aVencer = await http()
      .get('/oficina/despesas/a-vencer?dias=7')
      .auth(t.master, { type: 'bearer' })
      .expect(200);
    expect(d.financeiro.contasAVencer7DiasCentavos).toBe(aVencer.body.totalCentavos);
  });

  it('financeiro sem VER_SALARIOS: despesas e lucro sem salários', async () => {
    const d = await dashboard(t.financeiroSemSalarios);
    expect(d.financeiro).toMatchObject({
      despesasCentavos: DESPESAS - SALARIOS,
      lucroCentavos: FATURAMENTO - (DESPESAS - SALARIOS),
      incluiSalarios: false,
    });
    expect(JSON.stringify(d.financeiro)).not.toContain('Salários');
    const comSalarios = await dashboard(t.financeiro);
    expect(comSalarios.financeiro.despesasCentavos).toBe(DESPESAS);
  });

  it('gerente vê cards e gráficos, mas não o financeiro; mecânico comum: 403', async () => {
    const d = await dashboard(t.gerente);
    expect(d.cards.faturamentoCentavos).toBe(FATURAMENTO);
    expect(d.financeiro).toBeNull();
    await http().get('/oficina/dashboard').auth(t.mecanico, { type: 'bearer' }).expect(403);
    await http()
      .get('/oficina/dashboard/exportar')
      .auth(t.mecanico, { type: 'bearer' })
      .expect(403);
  });

  it('filtro por mecânico', async () => {
    const mecanico2 = await prisma.user.findFirstOrThrow({
      where: { oficinaId, email: 'mecanico2@oficina-exemplo.local' },
    });
    const d = await dashboard(t.master, `&mecanicoId=${mecanico2.id}`);
    expect(d.cards.faturamentoCentavos).toBe(0);
    expect(d.graficos.porMecanico).toHaveLength(1);
    expect(d.financeiro.receitasCentavos).toBe(FATURAMENTO); // financeiro é da oficina inteira
  });

  it('período sem movimento zera os cards', async () => {
    const d = await (
      await http()
        .get('/oficina/dashboard?de=2020-01-01&ate=2020-01-31')
        .auth(t.master, { type: 'bearer' })
        .expect(200)
    ).body;
    expect(d.cards).toMatchObject({
      faturamentoCentavos: 0,
      quantidadeOs: 0,
      ticketMedioCentavos: 0,
    });
    await http()
      .get('/oficina/dashboard?de=2026-02-01&ate=2026-01-01')
      .auth(t.master, { type: 'bearer' })
      .expect(400);
  });

  it('exporta PDF e Excel e registra a exportação na auditoria', async () => {
    const binario = (r: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
      const partes: Buffer[] = [];
      r.on('data', (p: Buffer) => partes.push(p));
      r.on('end', () => cb(null, Buffer.concat(partes)));
    };
    const pdf = await http()
      .get(`/oficina/dashboard/exportar?${periodo}&formato=pdf`)
      .auth(t.master, { type: 'bearer' })
      .buffer(true)
      .parse(binario)
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.headers['content-disposition']).toMatch(/attachment; filename="dashboard-/);

    const xlsx = await http()
      .get(`/oficina/dashboard/exportar?${periodo}&formato=xlsx`)
      .auth(t.master, { type: 'bearer' })
      .buffer(true)
      .parse(binario)
      .expect(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK'); // .xlsx é um zip

    const logs = await prisma.auditLog.count({ where: { oficinaId, acao: 'DASHBOARD_EXPORTADO' } });
    expect(logs).toBe(2);
  });

  it('não mistura dados de outra oficina', async () => {
    const outra = await prisma.oficina.findFirst({ where: { nome: 'Oficina Exemplo Box Certo' } });
    if (!outra || outra.id === oficinaId) return;
    const d = await dashboard(t.master);
    expect(d.cards.quantidadeOs).toBe(1);
  });
});
