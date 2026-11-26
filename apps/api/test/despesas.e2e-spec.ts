import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { dataLocal, localParaUtc, partesLocais, somarDias } from '../src/common/utils/datas.js';
import { CATEGORIAS_PADRAO } from '../src/despesas/categorias-padrao.js';
import { RecorrentesService } from '../src/despesas/recorrentes.service.js';
import type { PermissaoOficina, PrismaClient, UserRole } from '../src/generated/prisma/client.js';
import {
  criarApp,
  criarCenario,
  criarPrisma,
  SENHA,
  tokenOficina,
  type Cenario,
} from './helpers.js';

interface Despesa {
  id: string;
  status: string;
  valorCentavos: number;
  competencia?: string | null;
  categoria: { nome: string; ehSalario: boolean };
}
interface Categoria {
  id: string;
  nome: string;
  ehSalario: boolean;
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

describe('Despesas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  const t: Record<string, string> = {};
  let categorias: Record<string, string>;
  let categoriasB: Record<string, string>;

  const criarUsuario = async (role: UserRole, permissoes: PermissaoOficina[]) => {
    const email = `desp-${randomUUID().slice(0, 8)}@teste.local`;
    await prisma.user.create({
      data: {
        oficinaId: c.a.id,
        nome: `${role} ${permissoes.join('+')}`,
        email,
        senhaHash: await argon2.hash(SENHA),
        role,
        permissoes,
      },
    });
    return tokenOficina(app, email);
  };

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    for (const oficinaId of [c.a.id, c.b.id]) {
      await prisma.categoriaDespesa.createMany({
        data: CATEGORIAS_PADRAO.map((x) => ({ ...x, oficinaId, padrao: true })),
      });
    }
    const mapa = async (oficinaId: string) =>
      Object.fromEntries(
        (await prisma.categoriaDespesa.findMany({ where: { oficinaId } })).map((x) => [
          x.nome,
          x.id,
        ]),
      );
    categorias = await mapa(c.a.id);
    categoriasB = await mapa(c.b.id);

    t.master = await tokenOficina(app, c.a.master.email);
    t.mecanico = await tokenOficina(app, c.a.mecanico.email);
    t.gerente = await tokenOficina(app, c.a.mecanicoGerente.email);
    t.masterB = await tokenOficina(app, c.b.master.email);
    t.financeiro = await criarUsuario('FINANCEIRO', ['FINANCEIRO']);
    t.financeiroSalarios = await criarUsuario('FINANCEIRO', ['FINANCEIRO', 'VER_SALARIOS']);
    t.financeiroSemPermissao = await criarUsuario('FINANCEIRO', []);
    t.mecanicoComFinanceiro = await criarUsuario('MECANICO', ['FINANCEIRO']);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const lancar = (token: string, corpo: Record<string, unknown>) =>
    http()
      .post('/oficina/despesas')
      .auth(token, { type: 'bearer' })
      .send({
        descricao: 'Conta',
        valorCentavos: 10_000,
        categoriaId: categorias['Energia'],
        ...corpo,
      });

  describe('critério da fase: mecânico comum recebe 403 em tudo de despesas', () => {
    let despesaId: string;
    let categoriaId: string;
    let recorrenteId: string;

    beforeAll(async () => {
      despesaId = ((await lancar(t.master, {}).expect(201)).body as Despesa).id;
      categoriaId = categorias['Outros'];
      recorrenteId = (
        await http()
          .post('/oficina/despesas/recorrentes')
          .auth(t.master, { type: 'bearer' })
          .send({
            descricao: 'Internet',
            valorCentavos: 15_000,
            categoriaId: categorias['Internet'],
            diaVencimento: 28,
          })
          .expect(201)
      ).body.id as string;
    });

    const rotas = (): [string, string, Record<string, unknown>?][] => [
      ['get', '/oficina/despesas'],
      ['get', '/oficina/despesas/resumo'],
      ['get', '/oficina/despesas/a-vencer'],
      ['get', `/oficina/despesas/${despesaId}`],
      ['post', '/oficina/despesas', { descricao: 'x', valorCentavos: 1, categoriaId }],
      ['patch', `/oficina/despesas/${despesaId}`, { valorCentavos: 2 }],
      ['post', `/oficina/despesas/${despesaId}/pagar`, {}],
      ['delete', `/oficina/despesas/${despesaId}`, { motivo: 'x' }],
      ['post', `/oficina/despesas/${despesaId}/comprovantes`],
      ['get', '/oficina/despesas/categorias'],
      ['post', '/oficina/despesas/categorias', { nome: 'X' }],
      ['patch', `/oficina/despesas/categorias/${categoriaId}`, { nome: 'Y' }],
      ['get', '/oficina/despesas/recorrentes'],
      [
        'post',
        '/oficina/despesas/recorrentes',
        { descricao: 'x', valorCentavos: 1, categoriaId, diaVencimento: 1 },
      ],
      ['post', '/oficina/despesas/recorrentes/gerar', {}],
      ['get', `/oficina/despesas/recorrentes/${recorrenteId}`],
      ['patch', `/oficina/despesas/recorrentes/${recorrenteId}`, { valorCentavos: 1 }],
      ['delete', `/oficina/despesas/recorrentes/${recorrenteId}`],
    ];

    it.each(['mecanico', 'gerente', 'financeiroSemPermissao'])(
      '%s: 403 em todas as rotas',
      async (quem) => {
        for (const [metodo, url, corpo] of rotas()) {
          const r = await (http() as unknown as Record<string, (u: string) => request.Test>)
            [metodo](url)
            .auth(t[quem], { type: 'bearer' })
            .send(corpo ?? {});
          expect({ rota: `${metodo.toUpperCase()} ${url}`, status: r.status }).toEqual({
            rota: `${metodo.toUpperCase()} ${url}`,
            status: 403,
          });
        }
        // Nada mudou.
        const d = await prisma.despesa.findUniqueOrThrow({ where: { id: despesaId } });
        expect(d).toMatchObject({ status: 'A_PAGAR', valorCentavos: 10_000, deletedAt: null });
      },
    );

    it('a permissão FINANCEIRO libera (mesmo para quem é mecânico)', async () => {
      await http()
        .get('/oficina/despesas')
        .auth(t.mecanicoComFinanceiro, { type: 'bearer' })
        .expect(200);
      await http().get('/oficina/despesas').auth(t.financeiro, { type: 'bearer' }).expect(200);
    });
  });

  describe('lançamentos', () => {
    it('lança a pagar, paga e exclui com motivo', async () => {
      const amanha = localParaUtc(somarDias(dataLocal(new Date()), 1), 12 * 60);
      const d = (
        await lancar(t.financeiro, {
          descricao: 'Energia',
          valorCentavos: 45_990,
          vencimento: amanha,
        }).expect(201)
      ).body as Despesa & { vencimento: string };
      expect(d).toMatchObject({
        status: 'A_PAGAR',
        valorCentavos: 45_990,
        categoria: { nome: 'Energia' },
      });

      await http()
        .post(`/oficina/despesas/${d.id}/pagar`)
        .auth(t.financeiro, { type: 'bearer' })
        .send({ formaPagamento: 'Boleto' })
        .expect(200);
      const paga = await prisma.despesa.findUniqueOrThrow({ where: { id: d.id } });
      expect(paga).toMatchObject({ status: 'PAGO', formaPagamento: 'Boleto' });
      expect(paga.pagoEm).toBeInstanceOf(Date);
      await http()
        .post(`/oficina/despesas/${d.id}/pagar`)
        .auth(t.financeiro, { type: 'bearer' })
        .send({})
        .expect(422);

      await http()
        .delete(`/oficina/despesas/${d.id}`)
        .auth(t.financeiro, { type: 'bearer' })
        .send({})
        .expect(400);
      await http()
        .delete(`/oficina/despesas/${d.id}`)
        .auth(t.financeiro, { type: 'bearer' })
        .send({ motivo: 'Lançada em duplicidade' })
        .expect(204);
      await http()
        .get(`/oficina/despesas/${d.id}`)
        .auth(t.financeiro, { type: 'bearer' })
        .expect(404);
      expect(await prisma.despesa.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({
        motivoExclusao: 'Lançada em duplicidade',
      });
      const log = await prisma.auditLog.findFirst({
        where: { acao: 'DESPESA_EXCLUIDA', entidadeId: d.id },
      });
      expect(log?.motivo).toBe('Lançada em duplicidade');
    });

    it('valor em centavos inteiros', async () => {
      await lancar(t.financeiro, { valorCentavos: 10.5 }).expect(400);
    });

    it('contas a vencer e resumo', async () => {
      const hoje = dataLocal(new Date());
      await lancar(t.master, {
        descricao: 'Vencida',
        valorCentavos: 1_000,
        vencimento: localParaUtc(somarDias(hoje, -2), 720),
      }).expect(201);
      await lancar(t.master, {
        descricao: 'Vence em 3 dias',
        valorCentavos: 2_000,
        vencimento: localParaUtc(somarDias(hoje, 3), 720),
      }).expect(201);
      await lancar(t.master, {
        descricao: 'Vence em 20 dias',
        valorCentavos: 4_000,
        vencimento: localParaUtc(somarDias(hoje, 20), 720),
      }).expect(201);

      const r = await http()
        .get('/oficina/despesas/a-vencer?dias=7')
        .auth(t.financeiro, { type: 'bearer' })
        .expect(200);
      const nomes = (r.body.itens as { descricao: string; vencida: boolean }[]).map(
        (d) => `${d.descricao}:${d.vencida}`,
      );
      expect(nomes).toEqual(expect.arrayContaining(['Vencida:true', 'Vence em 3 dias:false']));
      expect(nomes).not.toContain('Vence em 20 dias:false');

      const resumo = await http()
        .get('/oficina/despesas/resumo')
        .auth(t.financeiro, { type: 'bearer' })
        .expect(200);
      expect(resumo.body.vencidasCentavos).toBeGreaterThanOrEqual(1_000);
      expect(
        (resumo.body.porCategoria as { categoria: string }[]).map((x) => x.categoria),
      ).toContain('Energia');
    });
  });

  describe('salários e VER_SALARIOS', () => {
    let salarioId: string;
    const salario = () => categorias['Salários e funcionários'];

    it('master paga funcionário com subtipo; subtipo é obrigatório', async () => {
      await lancar(t.master, { categoriaId: salario(), funcionarioId: c.a.mecanico.id }).expect(
        400,
      );
      await lancar(t.master, {
        categoriaId: categorias['Aluguel'],
        funcionarioId: c.a.mecanico.id,
        subtipoSalario: 'VALE',
      }).expect(400);
      await lancar(t.master, {
        categoriaId: salario(),
        funcionarioId: c.b.mecanico.id,
        subtipoSalario: 'SALARIO',
      }).expect(404);
      const r = await lancar(t.master, {
        descricao: 'Salário de novembro',
        valorCentavos: 250_000,
        categoriaId: salario(),
        funcionarioId: c.a.mecanico.id,
        subtipoSalario: 'SALARIO',
      }).expect(201);
      salarioId = r.body.id as string;
      expect(r.body).toMatchObject({
        subtipoSalario: 'SALARIO',
        funcionario: { id: c.a.mecanico.id },
      });
    });

    it('sem VER_SALARIOS: não vê nada de salário (lista, somas, resumo, categoria, detalhe)', async () => {
      const lista = await http()
        .get('/oficina/despesas?limite=200')
        .auth(t.financeiro, { type: 'bearer' })
        .expect(200);
      expect((lista.body.itens as Despesa[]).some((d) => d.categoria.ehSalario)).toBe(false);
      await http()
        .get(`/oficina/despesas/${salarioId}`)
        .auth(t.financeiro, { type: 'bearer' })
        .expect(404);
      await http()
        .patch(`/oficina/despesas/${salarioId}`)
        .auth(t.financeiro, { type: 'bearer' })
        .send({ valorCentavos: 1 })
        .expect(404);

      const resumo = await http()
        .get('/oficina/despesas/resumo')
        .auth(t.financeiro, { type: 'bearer' })
        .expect(200);
      expect(
        (resumo.body.porCategoria as { categoria: string }[]).map((x) => x.categoria),
      ).not.toContain('Salários e funcionários');
      const resumoMaster = await http()
        .get('/oficina/despesas/resumo')
        .auth(t.master, { type: 'bearer' })
        .expect(200);
      expect(resumoMaster.body.totalCentavos - resumo.body.totalCentavos).toBeGreaterThanOrEqual(
        250_000,
      );

      const cats = await http()
        .get('/oficina/despesas/categorias')
        .auth(t.financeiro, { type: 'bearer' })
        .expect(200);
      expect((cats.body as Categoria[]).some((x) => x.ehSalario)).toBe(false);
      await lancar(t.financeiro, { categoriaId: salario() }).expect(404);
      await http()
        .post('/oficina/despesas/categorias')
        .auth(t.financeiro, { type: 'bearer' })
        .send({ nome: 'Pró-labore', ehSalario: true })
        .expect(403);
    });

    it('com VER_SALARIOS vê e lança salários', async () => {
      await http()
        .get(`/oficina/despesas/${salarioId}`)
        .auth(t.financeiroSalarios, { type: 'bearer' })
        .expect(200);
      await lancar(t.financeiroSalarios, {
        categoriaId: salario(),
        funcionarioId: c.a.mecanicoLogs.id,
        subtipoSalario: 'COMISSAO',
        valorCentavos: 30_000,
      }).expect(201);
      const filtro = await http()
        .get(`/oficina/despesas?funcionarioId=${c.a.mecanico.id}`)
        .auth(t.financeiroSalarios, { type: 'bearer' })
        .expect(200);
      expect((filtro.body.itens as Despesa[]).map((d) => d.id)).toEqual([salarioId]);
    });
  });

  describe('recorrentes', () => {
    const hoje = partesLocais(new Date());
    const competenciaAtual = `${hoje.year}-${String(hoje.month).padStart(2, '0')}`;
    const proximoMes = localParaUtc(somarDias(`${competenciaAtual}-28`, 10), 12 * 60);
    const criar = (corpo: Record<string, unknown>, token = t.master) =>
      http()
        .post('/oficina/despesas/recorrentes')
        .auth(token, { type: 'bearer' })
        .send({ valorCentavos: 300_000, categoriaId: categorias['Aluguel'], ...corpo });

    it('vencimento ainda por vir: gera a despesa do mês atual na hora', async () => {
      const r = await criar({ descricao: 'Aluguel', diaVencimento: 31 }).expect(201);
      expect(r.body.despesaGeradaId).toEqual(expect.any(String));
      const d = await prisma.despesa.findUniqueOrThrow({
        where: { id: r.body.despesaGeradaId as string },
      });
      expect(d).toMatchObject({
        status: 'A_PAGAR',
        valorCentavos: 300_000,
        competencia: competenciaAtual,
        recorrenteId: r.body.id,
      });
    });

    it.skipIf(hoje.day === 1)('vencimento já passou: só a partir do próximo mês', async () => {
      const r = await criar({ descricao: 'Seguro', diaVencimento: hoje.day - 1 }).expect(201);
      expect(r.body.despesaGeradaId).toBeNull();
    });

    it('job do dia 1º gera o mês seguinte uma única vez', async () => {
      const r = await criar({
        descricao: 'Contador',
        diaVencimento: 5,
        valorCentavos: 50_000,
      }).expect(201);
      const job = app.get(RecorrentesService);
      await job.gerarTodas(proximoMes);
      await job.gerarTodas(proximoMes);
      const geradas = await prisma.despesa.findMany({
        where: { recorrenteId: r.body.id as string },
      });
      const competencias = geradas.map((g) => g.competencia).sort();
      expect(competencias).toHaveLength(new Set(competencias).size); // sem duplicatas
      expect(competencias).toContain(dataLocal(proximoMes).slice(0, 7));
    });

    it('recorrente desativada não gera', async () => {
      const r = await criar({ descricao: 'Antiga', diaVencimento: 10 }).expect(201);
      await http()
        .delete(`/oficina/despesas/recorrentes/${r.body.id as string}`)
        .auth(t.master, { type: 'bearer' })
        .expect(200);
      await app
        .get(RecorrentesService)
        .gerarTodas(localParaUtc(somarDias(`${competenciaAtual}-28`, 40), 720));
      const n = await prisma.despesa.count({
        where: { recorrenteId: r.body.id as string, competencia: { not: competenciaAtual } },
      });
      expect(n).toBe(0);
    });

    it('salário recorrente fica oculto para quem não tem VER_SALARIOS', async () => {
      const r = await criar({
        descricao: 'Salário fixo',
        categoriaId: categorias['Salários e funcionários'],
        funcionarioId: c.a.mecanico.id,
        subtipoSalario: 'SALARIO',
        diaVencimento: 31,
      }).expect(201);
      const lista = await http()
        .get('/oficina/despesas/recorrentes')
        .auth(t.financeiro, { type: 'bearer' })
        .expect(200);
      expect((lista.body as { id: string }[]).map((x) => x.id)).not.toContain(r.body.id);
      await http()
        .get(`/oficina/despesas/recorrentes/${r.body.id as string}`)
        .auth(t.financeiro, { type: 'bearer' })
        .expect(404);
    });
  });

  describe('categorias, comprovantes e isolamento', () => {
    it('categoria personalizada; padrão não muda; nome repetido 409', async () => {
      const r = await http()
        .post('/oficina/despesas/categorias')
        .auth(t.financeiro, { type: 'bearer' })
        .send({ nome: 'Marketing' })
        .expect(201);
      await http()
        .post('/oficina/despesas/categorias')
        .auth(t.financeiro, { type: 'bearer' })
        .send({ nome: 'Marketing' })
        .expect(409);
      await http()
        .patch(`/oficina/despesas/categorias/${r.body.id as string}`)
        .auth(t.financeiro, { type: 'bearer' })
        .send({ ativo: false })
        .expect(200);
      const p = await http()
        .patch(`/oficina/despesas/categorias/${categorias['Energia']}`)
        .auth(t.financeiro, { type: 'bearer' })
        .send({ nome: 'Luz' })
        .expect(422);
      expect(p.body.codigo).toBe('CATEGORIA_PADRAO');
    });

    it('comprovante em PDF; arquivo inválido é recusado', async () => {
      const d = (await lancar(t.financeiro, {}).expect(201)).body as Despesa;
      const r = await http()
        .post(`/oficina/despesas/${d.id}/comprovantes`)
        .auth(t.financeiro, { type: 'bearer' })
        .attach('arquivo', PDF, { filename: 'boleto.pdf', contentType: 'application/pdf' })
        .expect(201);
      expect(r.body).toMatchObject({ mime: 'application/pdf', nomeOriginal: 'boleto.pdf' });
      await http()
        .post(`/oficina/despesas/${d.id}/comprovantes`)
        .auth(t.financeiro, { type: 'bearer' })
        .attach('arquivo', Buffer.from('texto qualquer'), {
          filename: 'x.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);
      const det = await http()
        .get(`/oficina/despesas/${d.id}`)
        .auth(t.financeiro, { type: 'bearer' })
        .expect(200);
      expect(det.body.comprovantes).toHaveLength(1);
    });

    it('oficina B não vê nem usa nada da A (404)', async () => {
      const d = (await lancar(t.master, {}).expect(201)).body as Despesa;
      await http().get(`/oficina/despesas/${d.id}`).auth(t.masterB, { type: 'bearer' }).expect(404);
      await http()
        .post(`/oficina/despesas/${d.id}/pagar`)
        .auth(t.masterB, { type: 'bearer' })
        .send({})
        .expect(404);
      await http()
        .post('/oficina/despesas')
        .auth(t.masterB, { type: 'bearer' })
        .send({ descricao: 'x', valorCentavos: 1, categoriaId: categorias['Energia'] })
        .expect(404);
      await http()
        .post('/oficina/despesas')
        .auth(t.masterB, { type: 'bearer' })
        .send({ descricao: 'x', valorCentavos: 1, categoriaId: categoriasB['Energia'] })
        .expect(201);
    });
  });
});
