import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  criarApp,
  criarCenario,
  criarPrisma,
  SENHA,
  tokenOficina,
  type Cenario,
} from './helpers.js';

describe('Oficina: cadastro, configurações, horários, usuários e tabela de preços (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  let masterA: string;
  let masterB: string;
  let mecanicoA: string;
  let gerenteA: string;

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    masterA = await tokenOficina(app, c.a.master.email);
    masterB = await tokenOficina(app, c.b.master.email);
    mecanicoA = await tokenOficina(app, c.a.mecanico.email);
    gerenteA = await tokenOficina(app, c.a.mecanicoGerente.email);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('autocadastro público', () => {
    it('cria oficina em TESTE por 14 dias, master logado e horários padrão', async () => {
      const planos = await http().get('/publico/planos').expect(200);
      const autonomo =
        (planos.body as { id: string; nome: string }[]).find((p) => p.nome === 'Autônomo') ??
        (await prisma.plano.create({
          data: { nome: 'Autônomo', precoCentavos: 5900, maxMecanicos: 1 },
        }));

      const email = `dono-${randomUUID().slice(0, 8)}@teste.local`;
      const res = await http()
        .post('/publico/oficinas')
        .send({
          oficina: {
            nome: 'Mecânica do Zé',
            documento: '11.222.333/0001-81',
            telefone: '1133334444',
          },
          master: { nome: 'Zé', email, senha: SENHA },
          planoId: autonomo.id,
          aceiteTermos: true,
        })
        .expect(201);
      expect(res.body.ator).toMatchObject({ tipo: 'USUARIO', role: 'MASTER', email });
      const token = res.body.accessToken as string;

      const dados = await http().get('/oficina').auth(token, { type: 'bearer' }).expect(200);
      expect(dados.body).toMatchObject({ status: 'TESTE', documento: '11222333000181' });
      const dias = (new Date(dados.body.testeAte as string).getTime() - Date.now()) / 86_400_000;
      expect(Math.round(dias)).toBe(14);

      const horarios = await http()
        .get('/oficina/horarios')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect((horarios.body as { diaSemana: number }[]).map((h) => h.diaSemana)).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);

      // Plano Autônomo: o master já ocupa a única vaga de mecânico.
      const lim = await http()
        .post('/oficina/usuarios')
        .auth(token, { type: 'bearer' })
        .send({
          nome: 'Ajudante',
          email: `aj-${randomUUID().slice(0, 6)}@teste.local`,
          role: 'MECANICO',
          senha: SENHA,
        })
        .expect(422);
      expect(lim.body.codigo).toBe('LIMITE_DO_PLANO');
      // Financeiro não conta no limite.
      await http()
        .post('/oficina/usuarios')
        .auth(token, { type: 'bearer' })
        .send({
          nome: 'Contas',
          email: `fin-${randomUUID().slice(0, 6)}@teste.local`,
          role: 'FINANCEIRO',
          senha: SENHA,
        })
        .expect(201);

      const log = await prisma.auditLog.findFirst({
        where: {
          acao: 'OFICINA_CADASTRADA',
          atorId: res.body.ator.id as string,
          entidade: 'Oficina',
        },
      });
      expect(log).not.toBeNull();
    });

    it('recusa CNPJ inválido e cadastro sem aceite dos termos', async () => {
      const plano = await prisma.plano.findFirstOrThrow({ where: { ativo: true } });
      const res = await http()
        .post('/publico/oficinas')
        .send({
          oficina: { nome: 'X', documento: '11.222.333/0001-00' },
          master: { nome: 'X', email: 'x@teste.local', senha: SENHA },
          planoId: plano.id,
          aceiteTermos: false,
        })
        .expect(400);
      const msgs = (res.body.mensagem as string[]).join(' | ');
      expect(msgs).toMatch(/CPF ou CNPJ inválido/);
      expect(msgs).toMatch(/aceitar os termos/);
    });
  });

  describe('dados e configurações', () => {
    it('só o MASTER altera dados e parâmetros de desconto', async () => {
      await http()
        .patch('/oficina')
        .auth(mecanicoA, { type: 'bearer' })
        .send({ nome: 'X' })
        .expect(403);
      await http()
        .put('/oficina/configuracoes/descontos')
        .auth(gerenteA, { type: 'bearer' })
        .send({ mecanicoPodeDarDesconto: true })
        .expect(403);

      const res = await http()
        .put('/oficina/configuracoes/descontos')
        .auth(masterA, { type: 'bearer' })
        .send({ mecanicoPodeDarDesconto: true, limiteDescontoPercentual: 10, motivo: 'Campanha' })
        .expect(200);
      expect(res.body).toMatchObject({
        mecanicoPodeDarDesconto: true,
        limiteDescontoPercentual: 10,
      });

      const log = await prisma.auditLog.findFirst({
        where: { acao: 'CONFIG_DESCONTOS_ALTERADA', entidadeId: c.a.id },
      });
      expect(log).toMatchObject({ motivo: 'Campanha', atorId: c.a.master.id });

      await http()
        .put('/oficina/configuracoes/agendamento')
        .auth(masterA, { type: 'bearer' })
        .send({ antecedenciaCancelamentoHoras: 4 })
        .expect(200);
    });

    it('alteração da oficina A não afeta a B', async () => {
      await http()
        .patch('/oficina')
        .auth(masterA, { type: 'bearer' })
        .send({ cidade: 'Campinas', uf: 'SP' })
        .expect(200);
      const b = await http().get('/oficina').auth(masterB, { type: 'bearer' }).expect(200);
      expect(b.body.cidade).toBeNull();
    });
  });

  describe('horários', () => {
    it('define a semana; dias fora da lista ficam fechados', async () => {
      const res = await http()
        .put('/oficina/horarios')
        .auth(masterA, { type: 'bearer' })
        .send({
          dias: [
            {
              diaSemana: 1,
              abre: '08:00',
              fecha: '18:00',
              intervaloInicio: '12:00',
              intervaloFim: '13:00',
            },
            { diaSemana: 3, abre: '09:00', fecha: '17:00' },
          ],
        })
        .expect(200);
      expect((res.body as { diaSemana: number }[]).map((h) => h.diaSemana)).toEqual([1, 3]);

      const res2 = await http()
        .put('/oficina/horarios')
        .auth(masterA, { type: 'bearer' })
        .send({ dias: [{ diaSemana: 3, abre: '07:00', fecha: '16:00' }] })
        .expect(200);
      expect(res2.body).toEqual([
        { diaSemana: 3, abre: '07:00', fecha: '16:00', intervaloInicio: null, intervaloFim: null },
      ]);

      // Oficina B não foi afetada.
      const b = await http().get('/oficina/horarios').auth(masterB, { type: 'bearer' }).expect(200);
      expect(b.body).toEqual([]);
    });

    it('recusa horários incoerentes', async () => {
      const enviar = (dias: unknown) =>
        http().put('/oficina/horarios').auth(masterA, { type: 'bearer' }).send({ dias });
      await enviar([{ diaSemana: 1, abre: '18:00', fecha: '08:00' }]).expect(400);
      await enviar([
        {
          diaSemana: 1,
          abre: '08:00',
          fecha: '18:00',
          intervaloInicio: '19:00',
          intervaloFim: '20:00',
        },
      ]).expect(400);
      await enviar([{ diaSemana: 1, abre: '8h', fecha: '18:00' }]).expect(400);
      await enviar([
        { diaSemana: 2, abre: '08:00', fecha: '18:00' },
        { diaSemana: 2, abre: '09:00', fecha: '18:00' },
      ]).expect(400);
    });

    it('mecânico não altera horários', async () => {
      await http()
        .put('/oficina/horarios')
        .auth(mecanicoA, { type: 'bearer' })
        .send({ dias: [] })
        .expect(403);
    });
  });

  describe('usuários e permissões', () => {
    let novoId: string;

    it('MASTER cria mecânico; e-mail repetido na mesma oficina: 409', async () => {
      const email = `novo-${randomUUID().slice(0, 8)}@teste.local`;
      const res = await http()
        .post('/oficina/usuarios')
        .auth(masterA, { type: 'bearer' })
        .send({
          nome: 'Novo Mecânico',
          email,
          role: 'MECANICO',
          permissoes: ['GERIR_ESTOQUE'],
          senha: SENHA,
        })
        .expect(201);
      expect(res.body).toMatchObject({
        oficinaId: c.a.id,
        role: 'MECANICO',
        permissoes: ['GERIR_ESTOQUE'],
      });
      expect(JSON.stringify(res.body)).not.toContain('senhaHash');
      novoId = res.body.id as string;

      await http()
        .post('/oficina/usuarios')
        .auth(masterA, { type: 'bearer' })
        .send({ nome: 'Dup', email, role: 'FINANCEIRO', senha: SENHA })
        .expect(409);

      // O mesmo e-mail pode existir em outra oficina.
      await http()
        .post('/oficina/usuarios')
        .auth(masterB, { type: 'bearer' })
        .send({ nome: 'Outro', email, role: 'FINANCEIRO', senha: SENHA })
        .expect(201);
    });

    it('não permite criar outro MASTER nem usuário sem ser MASTER', async () => {
      await http()
        .post('/oficina/usuarios')
        .auth(masterA, { type: 'bearer' })
        .send({ nome: 'M2', email: 'm2@teste.local', role: 'MASTER', senha: SENHA })
        .expect(400);
      await http()
        .post('/oficina/usuarios')
        .auth(gerenteA, { type: 'bearer' })
        .send({ nome: 'X', email: 'x2@teste.local', role: 'MECANICO', senha: SENHA })
        .expect(403);
    });

    it('limite do plano: Oficina permite 5 (master + mecânicos ativos)', async () => {
      // A já tem master + 3 mecânicos (cenário) + 1 criado acima = 5.
      const res = await http()
        .post('/oficina/usuarios')
        .auth(masterA, { type: 'bearer' })
        .send({
          nome: 'Sexto',
          email: `sexto-${randomUUID().slice(0, 6)}@teste.local`,
          role: 'MECANICO',
          senha: SENHA,
        })
        .expect(422);
      expect(res.body.codigo).toBe('LIMITE_DO_PLANO');
    });

    it('VER_SALARIOS exige FINANCEIRO; mudança de permissão é auditada', async () => {
      await http()
        .put(`/oficina/usuarios/${novoId}/permissoes`)
        .auth(masterA, { type: 'bearer' })
        .send({ permissoes: ['VER_SALARIOS'] })
        .expect(400);
      await http()
        .put(`/oficina/usuarios/${novoId}/permissoes`)
        .auth(masterA, { type: 'bearer' })
        .send({ permissoes: ['FINANCEIRO', 'VER_SALARIOS'], motivo: 'Ajuda no caixa' })
        .expect(200);
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { acao: 'USUARIO_PERMISSOES_ALTERADAS', entidadeId: novoId },
      });
      expect(log.antes).toMatchObject({ permissoes: ['GERIR_ESTOQUE'] });
      expect(log.depois).toMatchObject({ permissoes: ['FINANCEIRO', 'VER_SALARIOS'] });
      expect(log.motivo).toBe('Ajuda no caixa');
    });

    it('desativar encerra sessões e libera vaga; reativar respeita o limite', async () => {
      const email = (await prisma.user.findUniqueOrThrow({ where: { id: novoId } })).email;
      const sessao = await http()
        .post('/auth/oficina/login')
        .send({ email, senha: SENHA, oficinaId: c.a.id }) // e-mail também existe na oficina B
        .expect(200);

      await http()
        .patch(`/oficina/usuarios/${novoId}/status`)
        .auth(masterA, { type: 'bearer' })
        .send({ ativo: false })
        .expect(200);
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: sessao.body.refreshToken })
        .expect(401);
      await http()
        .get('/auth/me')
        .auth(sessao.body.accessToken as string, { type: 'bearer' })
        .expect(401);

      // Vaga liberada: dá para criar outro mecânico; aí reativar o antigo estoura o limite.
      await http()
        .post('/oficina/usuarios')
        .auth(masterA, { type: 'bearer' })
        .send({
          nome: 'Substituto',
          email: `sub-${randomUUID().slice(0, 6)}@teste.local`,
          role: 'MECANICO',
          senha: SENHA,
        })
        .expect(201);
      const r = await http()
        .patch(`/oficina/usuarios/${novoId}/status`)
        .auth(masterA, { type: 'bearer' })
        .send({ ativo: true })
        .expect(422);
      expect(r.body.codigo).toBe('LIMITE_DO_PLANO');
    });

    it('o master não pode ser desativado nem ter o perfil trocado', async () => {
      await http()
        .patch(`/oficina/usuarios/${c.a.master.id}/status`)
        .auth(masterA, { type: 'bearer' })
        .send({ ativo: false })
        .expect(403);
      await http()
        .patch(`/oficina/usuarios/${c.a.master.id}`)
        .auth(masterA, { type: 'bearer' })
        .send({ role: 'FINANCEIRO' })
        .expect(403);
    });

    it('MASTER redefine a senha de um usuário; usuário troca a própria senha', async () => {
      await http()
        .post(`/oficina/usuarios/${c.a.mecanico.id}/senha`)
        .auth(masterA, { type: 'bearer' })
        .send({ novaSenha: 'Nova-senha-456' })
        .expect(204);
      await http()
        .post('/auth/oficina/login')
        .send({ email: c.a.mecanico.email, senha: SENHA })
        .expect(401);
      const login = await http()
        .post('/auth/oficina/login')
        .send({ email: c.a.mecanico.email, senha: 'Nova-senha-456' })
        .expect(200);

      await http()
        .post('/auth/senha')
        .auth(login.body.accessToken as string, { type: 'bearer' })
        .send({ senhaAtual: 'errada', novaSenha: SENHA })
        .expect(401);
      await http()
        .post('/auth/senha')
        .auth(login.body.accessToken as string, { type: 'bearer' })
        .send({ senhaAtual: 'Nova-senha-456', novaSenha: SENHA })
        .expect(200);
      await http()
        .post('/auth/oficina/login')
        .send({ email: c.a.mecanico.email, senha: SENHA })
        .expect(200);
    });

    it('não altera usuários de outra oficina', async () => {
      await http()
        .put(`/oficina/usuarios/${c.b.mecanico.id}/permissoes`)
        .auth(masterA, { type: 'bearer' })
        .send({ permissoes: ['GERENTE'] })
        .expect(404);
      await http()
        .patch(`/oficina/usuarios/${c.b.mecanico.id}/status`)
        .auth(masterA, { type: 'bearer' })
        .send({ ativo: false })
        .expect(404);
      const b = await prisma.user.findUniqueOrThrow({ where: { id: c.b.mecanico.id } });
      expect(b).toMatchObject({ ativo: true, permissoes: [] });
    });
  });

  describe('tabela de preços', () => {
    let itemId: string;

    it('MASTER/GERENTE criam; mecânico comum só consulta', async () => {
      const res = await http()
        .post('/oficina/tabela-precos')
        .auth(gerenteA, { type: 'bearer' })
        .send({
          nome: 'Pastilha de freio',
          tipo: 'PECA',
          precoCentavos: 18990,
          linkAfiliadoPadrao: 'https://loja.exemplo/pastilha',
        })
        .expect(201);
      itemId = res.body.id as string;
      expect(res.body).toMatchObject({ oficinaId: c.a.id, precoCentavos: 18990 });

      await http()
        .post('/oficina/tabela-precos')
        .auth(mecanicoA, { type: 'bearer' })
        .send({ nome: 'X', tipo: 'MAO_DE_OBRA', precoCentavos: 100 })
        .expect(403);
      const lista = await http()
        .get('/oficina/tabela-precos?q=pastilha')
        .auth(mecanicoA, { type: 'bearer' })
        .expect(200);
      expect((lista.body as { id: string }[]).map((i) => i.id)).toEqual([itemId]);
    });

    it('preço precisa ser inteiro em centavos', async () => {
      await http()
        .post('/oficina/tabela-precos')
        .auth(masterA, { type: 'bearer' })
        .send({ nome: 'Alinhamento', tipo: 'MAO_DE_OBRA', precoCentavos: 89.9 })
        .expect(400);
    });

    it('desativar é exclusão lógica; outra oficina não enxerga', async () => {
      await http()
        .get(`/oficina/tabela-precos/${itemId}`)
        .auth(masterB, { type: 'bearer' })
        .expect(404);
      await http()
        .delete(`/oficina/tabela-precos/${itemId}`)
        .auth(masterB, { type: 'bearer' })
        .expect(404);

      await http()
        .delete(`/oficina/tabela-precos/${itemId}`)
        .auth(masterA, { type: 'bearer' })
        .expect(200);
      expect(await prisma.itemTabelaPreco.findUnique({ where: { id: itemId } })).toMatchObject({
        ativo: false,
      });
      const lista = await http()
        .get('/oficina/tabela-precos')
        .auth(masterA, { type: 'bearer' })
        .expect(200);
      expect((lista.body as { id: string }[]).map((i) => i.id)).not.toContain(itemId);
    });

    it('o cliente não acessa a tabela de preços', async () => {
      const login = await http()
        .post('/auth/cliente/login')
        .send({ login: c.cliente.email, senha: SENHA })
        .expect(200);
      await http()
        .get('/oficina/tabela-precos')
        .auth(login.body.accessToken as string, { type: 'bearer' })
        .expect(403);
    });
  });
});
