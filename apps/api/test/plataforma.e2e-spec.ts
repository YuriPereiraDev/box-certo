import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { TotpService } from '../src/auth/totp.service.js';
import { CriptografiaService } from '../src/common/cripto/criptografia.service.js';
import { localParaUtc, dataLocal } from '../src/common/utils/datas.js';
import type { PermissaoPlataforma, PrismaClient } from '../src/generated/prisma/client.js';
import {
  criarApp,
  criarCenario,
  criarPrisma,
  SENHA,
  tokenAdmin,
  tokenCliente,
  tokenOficina,
  type AdminCenario,
  type Cenario,
} from './helpers.js';

describe('Plataforma (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  const t: Record<string, string> = {};
  const admins: Record<string, AdminCenario> = {};

  const criarAdmin = async (permissoes: PermissaoPlataforma[]): Promise<AdminCenario> => {
    const totp = app.get(TotpService);
    const segredoTotp = totp.gerarSegredo();
    const email = `adm-${randomUUID().slice(0, 8)}@teste.local`;
    const admin = await prisma.platformAdmin.create({
      data: {
        nome: `Admin ${permissoes.join('+') || 'sem permissão'}`,
        email,
        senhaHash: await argon2.hash(SENHA),
        permissoes,
        totpSecret: app.get(CriptografiaService).criptografar(segredoTotp),
        totpAtivadoEm: new Date(),
      },
    });
    return { id: admin.id, email, segredoTotp };
  };

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    admins.dono = c.dono;
    admins.semPermissao = c.adminSemPermissao;
    admins.gestaoAdmins = c.adminGestaoAdmins;
    admins.oficinas = await criarAdmin(['GESTAO_OFICINAS']);
    admins.financeiro = await criarAdmin(['FINANCEIRO']);
    admins.usuarios = await criarAdmin(['GESTAO_USUARIOS']);
    admins.suporte = await criarAdmin(['SUPORTE']);
    for (const [nome, admin] of Object.entries(admins)) t[nome] = await tokenAdmin(app, admin);
    await prisma.oficina.update({ where: { id: c.a.id }, data: { precoFundadorCentavos: 8_900 } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const get = (url: string, token: string) => http().get(url).auth(token, { type: 'bearer' });

  describe('critério da fase: admin sem FINANCEIRO não vê valores', () => {
    it.each(['semPermissao', 'oficinas', 'usuarios', 'suporte', 'gestaoAdmins'])(
      '%s: dashboard, oficinas e planos sem nenhum valor',
      async (quem) => {
        const dash = await get('/plataforma/dashboard', t[quem]).expect(200);
        expect(dash.body.financeiro).toBeNull();
        const lista = await get('/plataforma/oficinas?limite=200', t[quem]).expect(200);
        const det = await get(`/plataforma/oficinas/${c.a.id}`, t[quem]).expect(200);
        const planos = await get('/plataforma/planos', t[quem]).expect(200);
        for (const corpo of [dash.body, lista.body, det.body, planos.body]) {
          expect(JSON.stringify(corpo)).not.toMatch(/Centavos/);
        }
      },
    );

    it('dono e admin com FINANCEIRO veem valores', async () => {
      for (const quem of ['dono', 'financeiro']) {
        const dash = await get('/plataforma/dashboard', t[quem]).expect(200);
        expect(dash.body.financeiro).toMatchObject({
          faturamentoMensalCentavos: expect.any(Number),
          rankingFaturamentoOficinas: expect.any(Array),
        });
        const det = await get(`/plataforma/oficinas/${c.a.id}`, t[quem]).expect(200);
        expect(det.body).toMatchObject({
          precoFundadorCentavos: 8_900,
          mensalidadeCentavos: 8_900,
          faturamentoMesCentavos: expect.any(Number),
          plano: { precoCentavos: expect.any(Number) },
        });
        const planos = await get('/plataforma/planos', t[quem]).expect(200);
        expect(
          (planos.body as { precoCentavos?: number }[]).every(
            (p) => typeof p.precoCentavos === 'number',
          ),
        ).toBe(true);
      }
    });

    it('alterar valores exige FINANCEIRO', async () => {
      await http()
        .put(`/plataforma/oficinas/${c.a.id}/preco-fundador`)
        .auth(t.oficinas, { type: 'bearer' })
        .send({ precoFundadorCentavos: 1 })
        .expect(403);
      await http()
        .post('/plataforma/planos')
        .auth(t.oficinas, { type: 'bearer' })
        .send({ nome: 'X', precoCentavos: 1 })
        .expect(403);
      await http()
        .put(`/plataforma/oficinas/${c.a.id}/preco-fundador`)
        .auth(t.financeiro, { type: 'bearer' })
        .send({ precoFundadorCentavos: 9_900 })
        .expect(200);
    });

    it('faturamento do Box Certo = mensalidades das oficinas ativas (preço fundador quando houver)', async () => {
      const ativas = await prisma.oficina.findMany({
        where: { status: 'ATIVA', deletedAt: null },
        include: { plano: true },
      });
      const esperado = ativas.reduce(
        (s, o) => s + (o.precoFundadorCentavos ?? o.plano.precoCentavos),
        0,
      );
      const dash = await get('/plataforma/dashboard', t.dono).expect(200);
      expect(dash.body.financeiro.faturamentoMensalCentavos).toBe(esperado);
    });
  });

  describe('admins', () => {
    it('cria admin com senha temporária; 2FA é configurado no primeiro login', async () => {
      const r = await http()
        .post('/plataforma/admins')
        .auth(t.gestaoAdmins, { type: 'bearer' })
        .send({
          nome: 'Novo',
          email: `novo-${randomUUID().slice(0, 6)}@teste.local`,
          permissoes: ['GESTAO_ADMINS'],
        })
        .expect(201);
      expect(r.body.senhaTemporaria).toMatch(/^.{12}$/);
      expect(JSON.stringify(r.body.admin)).not.toMatch(/senhaHash|totpSecret/);
      const login = await http()
        .post('/auth/plataforma/login')
        .send({ email: r.body.admin.email, senha: r.body.senhaTemporaria })
        .expect(200);
      expect(login.body.requerConfiguracao2fa).toBe(true);
    });

    it('não concede permissão que não tem (FINANCEIRO); o dono pode', async () => {
      const email = `f-${randomUUID().slice(0, 6)}@teste.local`;
      await http()
        .post('/plataforma/admins')
        .auth(t.gestaoAdmins, { type: 'bearer' })
        .send({ nome: 'X', email, permissoes: ['FINANCEIRO'] })
        .expect(403);
      const r = await http()
        .post('/plataforma/admins')
        .auth(t.dono, { type: 'bearer' })
        .send({ nome: 'X', email, permissoes: ['FINANCEIRO'] })
        .expect(201);
      expect(r.body.admin.permissoes).toEqual(['FINANCEIRO']);
    });

    it('dono e a própria conta não são alterados por aqui; bloquear derruba a sessão', async () => {
      await http()
        .patch(`/plataforma/admins/${c.dono.id}/status`)
        .auth(t.gestaoAdmins, { type: 'bearer' })
        .send({ ativo: false })
        .expect(403);
      await http()
        .patch(`/plataforma/admins/${c.adminGestaoAdmins.id}/status`)
        .auth(t.gestaoAdmins, { type: 'bearer' })
        .send({ ativo: false })
        .expect(403);

      const alvo = await criarAdmin([]);
      const tokenAlvo = await tokenAdmin(app, alvo);
      await http()
        .patch(`/plataforma/admins/${alvo.id}/status`)
        .auth(t.gestaoAdmins, { type: 'bearer' })
        .send({ ativo: false })
        .expect(200);
      await get('/plataforma/dashboard', tokenAlvo).expect(401);
    });

    it('sem GESTAO_ADMINS: 403', async () => {
      await get('/plataforma/admins', t.oficinas).expect(403);
    });
  });

  describe('oficinas', () => {
    it('suspender bloqueia os usuários (403) e reativar libera; motivo é registrado', async () => {
      await http()
        .patch(`/plataforma/oficinas/${c.b.id}/status`)
        .auth(t.semPermissao, { type: 'bearer' })
        .send({ status: 'SUSPENSA', motivo: 'x' })
        .expect(403);
      await http()
        .patch(`/plataforma/oficinas/${c.b.id}/status`)
        .auth(t.oficinas, { type: 'bearer' })
        .send({ status: 'SUSPENSA', motivo: 'Inadimplência' })
        .expect(200);
      const login = await http()
        .post('/auth/oficina/login')
        .send({ email: c.b.master.email, senha: SENHA })
        .expect(403);
      expect(login.body.codigo).toBe('OFICINA_SUSPENSA');
      const log = await prisma.auditLog.findFirst({
        where: { acao: 'OFICINA_STATUS_ALTERADO', entidadeId: c.b.id },
      });
      expect(log?.motivo).toBe('Inadimplência');

      await http()
        .patch(`/plataforma/oficinas/${c.b.id}/status`)
        .auth(t.oficinas, { type: 'bearer' })
        .send({ status: 'ATIVA', motivo: 'Pagou' })
        .expect(200);
      await http()
        .post('/auth/oficina/login')
        .send({ email: c.b.master.email, senha: SENHA })
        .expect(200);
    });

    it('trocar para plano menor que os mecânicos ativos: 422', async () => {
      const autonomo = await prisma.plano.upsert({
        where: { nome: 'Autônomo' },
        update: {},
        create: { nome: 'Autônomo', precoCentavos: 5_900, maxMecanicos: 1 },
      });
      const r = await http()
        .patch(`/plataforma/oficinas/${c.a.id}/plano`)
        .auth(t.oficinas, { type: 'bearer' })
        .send({ planoId: autonomo.id })
        .expect(422);
      expect(r.body.codigo).toBe('LIMITE_DO_PLANO');
    });

    it('cria oficina com master de senha temporária; estende o teste', async () => {
      const plano = await prisma.plano.findFirstOrThrow({ where: { nome: 'Oficina' } });
      const email = `master-plat-${randomUUID().slice(0, 6)}@teste.local`;
      const r = await http()
        .post('/plataforma/oficinas')
        .auth(t.oficinas, { type: 'bearer' })
        .send({
          oficina: { nome: 'Criada pela plataforma' },
          master: { nome: 'Dono', email },
          planoId: plano.id,
        })
        .expect(201);
      expect(r.body.oficina).toMatchObject({ status: 'TESTE', master: { email } });
      const tokenMaster = (
        await http()
          .post('/auth/oficina/login')
          .send({ email, senha: r.body.senhaTemporariaMaster })
          .expect(200)
      ).body.accessToken as string;
      const cats = await get('/oficina/despesas/categorias', tokenMaster).expect(200);
      expect((cats.body as unknown[]).length).toBe(10);

      const antes = new Date(r.body.oficina.testeAte as string).getTime();
      const e = await http()
        .post(`/plataforma/oficinas/${r.body.oficina.id as string}/estender-teste`)
        .auth(t.oficinas, { type: 'bearer' })
        .send({ dias: 10 })
        .expect(200);
      expect(Math.round((new Date(e.body.testeAte as string).getTime() - antes) / 86_400_000)).toBe(
        10,
      );
      await http()
        .post(`/plataforma/oficinas/${c.a.id}/estender-teste`)
        .auth(t.oficinas, { type: 'bearer' })
        .send({ dias: 10 })
        .expect(422);
    });

    it('exporta os dados da oficina (LGPD) sem senhas', async () => {
      const r = await http()
        .get(`/plataforma/oficinas/${c.a.id}/exportar`)
        .auth(t.oficinas, { type: 'bearer' })
        .buffer(true)
        .parse((res, cb) => {
          const p: Buffer[] = [];
          res.on('data', (x: Buffer) => p.push(x));
          res.on('end', () => cb(null, Buffer.concat(p)));
        })
        .expect(200);
      const texto = (r.body as Buffer).toString();
      const dados = JSON.parse(texto) as {
        usuarios: unknown[];
        clientes: unknown[];
        oficina: { id: string };
      };
      expect(dados.oficina.id).toBe(c.a.id);
      expect(dados.usuarios.length).toBe(4);
      expect(texto).not.toMatch(/senhaHash|\$argon2/);
      expect(
        await prisma.auditLog.count({
          where: { acao: 'OFICINA_DADOS_EXPORTADOS', entidadeId: c.a.id },
        }),
      ).toBe(1);
    });
  });

  describe('contas (GESTAO_USUARIOS)', () => {
    it('busca, bloqueia e reseta senha de usuário e de cliente', async () => {
      await get(`/plataforma/contas?q=${c.a.mecanico.email}`, t.oficinas).expect(403);
      const busca = await get(
        `/plataforma/contas?q=${encodeURIComponent(c.a.mecanico.email)}`,
        t.usuarios,
      ).expect(200);
      expect((busca.body.usuarios as { id: string }[]).map((u) => u.id)).toEqual([c.a.mecanico.id]);
      expect(JSON.stringify(busca.body)).not.toContain('senhaHash');

      await http()
        .patch(`/plataforma/usuarios/${c.a.mecanico.id}/status`)
        .auth(t.usuarios, { type: 'bearer' })
        .send({ ativo: false })
        .expect(200);
      await http()
        .post('/auth/oficina/login')
        .send({ email: c.a.mecanico.email, senha: SENHA })
        .expect(401);
      await http()
        .patch(`/plataforma/usuarios/${c.a.mecanico.id}/status`)
        .auth(t.usuarios, { type: 'bearer' })
        .send({ ativo: true })
        .expect(200);

      const reset = await http()
        .post(`/plataforma/usuarios/${c.a.mecanico.id}/resetar-senha`)
        .auth(t.usuarios, { type: 'bearer' })
        .expect(200);
      await http()
        .post('/auth/oficina/login')
        .send({ email: c.a.mecanico.email, senha: SENHA })
        .expect(401);
      await http()
        .post('/auth/oficina/login')
        .send({ email: c.a.mecanico.email, senha: reset.body.senhaTemporaria })
        .expect(200);
      await prisma.user.update({
        where: { id: c.a.mecanico.id },
        data: { senhaHash: await argon2.hash(SENHA) },
      });

      const porCpf = await get(`/plataforma/contas?q=${c.cliente.cpf}`, t.usuarios).expect(200);
      expect((porCpf.body.clientes as { id: string }[]).map((x) => x.id)).toEqual([c.cliente.id]);
      const resetCli = await http()
        .post(`/plataforma/clientes/${c.cliente.id}/resetar-senha`)
        .auth(t.usuarios, { type: 'bearer' })
        .expect(200);
      // A senha antiga deixa de valer.
      await http()
        .post('/auth/cliente/login')
        .send({ login: c.cliente.email, senha: SENHA })
        .expect(401);
      await http()
        .post('/auth/cliente/login')
        .send({ login: c.cliente.email, senha: resetCli.body.senhaTemporaria })
        .expect(200);
      await prisma.cliente.update({
        where: { id: c.cliente.id },
        data: { senhaHash: await argon2.hash(SENHA) },
      });
    });
  });

  describe('avisos globais', () => {
    it('SUPORTE publica; todos os logados veem só os vigentes', async () => {
      await http()
        .post('/plataforma/avisos')
        .auth(t.oficinas, { type: 'bearer' })
        .send({ titulo: 'x', mensagem: 'y' })
        .expect(403);
      const titulo = `Manutenção ${randomUUID().slice(0, 6)}`;
      await http()
        .post('/plataforma/avisos')
        .auth(t.suporte, { type: 'bearer' })
        .send({ titulo, mensagem: 'Domingo 2h–4h' })
        .expect(201);
      const futuro = `Futuro ${randomUUID().slice(0, 6)}`;
      await http()
        .post('/plataforma/avisos')
        .auth(t.suporte, { type: 'bearer' })
        .send({ titulo: futuro, mensagem: 'x', inicio: new Date(Date.now() + 86_400_000) })
        .expect(201);

      const doCliente = await get('/avisos', await tokenCliente(app, c.cliente.email)).expect(200);
      const titulos = (doCliente.body as { titulo: string }[]).map((a) => a.titulo);
      expect(titulos).toContain(titulo);
      expect(titulos).not.toContain(futuro);
      await get('/avisos', await tokenOficina(app, c.a.master.email)).expect(200);
    });
  });

  describe('modo suporte', () => {
    let tokenSuporte: string;
    let sessaoId: string;

    beforeAll(async () => {
      const r = await http()
        .post('/plataforma/suporte/sessoes')
        .auth(t.suporte, { type: 'bearer' })
        .send({ oficinaId: c.a.id, motivo: 'Ticket #42: ajuda com usuários', duracaoMin: 30 })
        .expect(201);
      tokenSuporte = r.body.accessToken as string;
      sessaoId = r.body.sessaoId as string;
    });

    it('só admins com SUPORTE abrem sessão', async () => {
      await http()
        .post('/plataforma/suporte/sessoes')
        .auth(t.oficinas, { type: 'bearer' })
        .send({ oficinaId: c.a.id, motivo: 'x' })
        .expect(403);
    });

    it('age como master da oficina: lê e altera, e tudo é auditado como SUPORTE', async () => {
      const usuarios = await get('/oficina/usuarios', tokenSuporte).expect(200);
      expect((usuarios.body as unknown[]).length).toBe(4);
      await get('/oficina/despesas', tokenSuporte).expect(200);

      await http()
        .patch(`/oficina/usuarios/${c.a.mecanicoLogs.id}`)
        .auth(tokenSuporte, { type: 'bearer' })
        .send({ telefone: '11911112222', motivo: 'Pedido do master pelo ticket #42' })
        .expect(200);
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { acao: 'USUARIO_ATUALIZADO', entidadeId: c.a.mecanicoLogs.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).toMatchObject({
        atorTipo: 'SUPORTE',
        atorId: admins.suporte.id,
        oficinaId: c.a.id,
      });

      // Nos logs da oficina aparece como "Suporte Box Certo".
      const logsOficina = await get(
        `/oficina/logs?entidadeId=${c.a.mecanicoLogs.id}`,
        await tokenOficina(app, c.a.master.email),
      ).expect(200);
      const doSuporte = (logsOficina.body.itens as { atorTipo: string; atorNome: string }[]).find(
        (l) => l.atorTipo === 'SUPORTE',
      );
      expect(doSuporte?.atorNome).toBe('Suporte Box Certo');
    });

    it('fica preso à oficina da sessão', async () => {
      await get(`/oficina/usuarios/${c.b.master.id}`, tokenSuporte).expect(404);
    });

    it('não vira mecânico: abrir OS exige informar o mecânico', async () => {
      const veiculo = await prisma.veiculo.create({
        data: { clienteId: c.cliente.id, placa: 'SUP0R7E' },
      });
      const sem = await http()
        .post('/oficina/ordens-servico')
        .auth(tokenSuporte, { type: 'bearer' })
        .send({ clienteId: c.cliente.id, veiculoId: veiculo.id })
        .expect(400);
      expect(sem.body.mensagem).toMatch(/mecânico/);
      await http()
        .post('/oficina/ordens-servico')
        .auth(tokenSuporte, { type: 'bearer' })
        .send({ clienteId: c.cliente.id, veiculoId: veiculo.id, mecanicoId: c.a.mecanico.id })
        .expect(201);
    });

    it('não troca senha e não usa rotas da plataforma com o token de suporte', async () => {
      await http()
        .post('/auth/senha')
        .auth(tokenSuporte, { type: 'bearer' })
        .send({ senhaAtual: 'x', novaSenha: 'y'.repeat(10) })
        .expect(403);
      await get('/plataforma/dashboard', tokenSuporte).expect(403);
    });

    it('funciona com a oficina suspensa', async () => {
      await prisma.oficina.update({ where: { id: c.a.id }, data: { status: 'SUSPENSA' } });
      try {
        await get('/oficina', tokenSuporte).expect(200);
      } finally {
        await prisma.oficina.update({ where: { id: c.a.id }, data: { status: 'ATIVA' } });
      }
    });

    it('encerrar ou expirar a sessão derruba o token', async () => {
      await http()
        .post(`/plataforma/suporte/sessoes/${sessaoId}/encerrar`)
        .auth(t.suporte, { type: 'bearer' })
        .expect(200);
      await get('/oficina/usuarios', tokenSuporte).expect(401);

      const r = await http()
        .post('/plataforma/suporte/sessoes')
        .auth(t.suporte, { type: 'bearer' })
        .send({ oficinaId: c.a.id, motivo: 'Outra' })
        .expect(201);
      await prisma.sessaoSuporte.update({
        where: { id: r.body.sessaoId as string },
        data: { expiraEm: new Date(Date.now() - 1000) },
      });
      await get('/oficina/usuarios', r.body.accessToken as string).expect(401);
    });

    it('início e fim da sessão ficam nos logs', async () => {
      const acoes = (
        await prisma.auditLog.findMany({ where: { entidadeId: sessaoId }, select: { acao: true } })
      ).map((l) => l.acao);
      expect(acoes).toEqual(
        expect.arrayContaining(['SUPORTE_SESSAO_INICIADA', 'SUPORTE_SESSAO_ENCERRADA']),
      );
    });
  });

  describe('logs: alertas e saúde', () => {
    it('falhas de login, exclusões em massa e atividade de madrugada', async () => {
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/auth/oficina/login')
          .send({ email: 'atacante@teste.local', senha: 'x' })
          .expect(401);
      }
      const atorId = randomUUID();
      const agora = Date.now();
      await prisma.auditLog.createMany({
        data: Array.from({ length: 10 }, (_, i) => ({
          atorTipo: 'USUARIO' as const,
          atorId,
          atorNome: 'Apagador',
          oficinaId: c.a.id,
          acao: 'DESPESA_EXCLUIDA',
          entidade: 'Despesa',
          createdAt: new Date(agora - i * 30_000),
        })),
      });
      const madrugadaId = randomUUID();
      const ontemTresDaManha = localParaUtc(dataLocal(new Date(agora - 12 * 3_600_000)), 3 * 60);
      await prisma.auditLog.create({
        data: {
          atorTipo: 'USUARIO',
          atorId: madrugadaId,
          atorNome: 'Corujão',
          oficinaId: c.a.id,
          acao: 'X',
          entidade: 'Y',
          createdAt: ontemTresDaManha,
        },
      });

      const r = await get('/plataforma/logs/alertas?horas=48', t.semPermissao).expect(200);
      expect(
        (r.body.falhasDeLogin as { tentativas: number }[]).some((f) => f.tentativas >= 5),
      ).toBe(true);
      expect(
        (r.body.exclusoesEmMassa as { atorId: string; maiorSequencia10Min: number }[]).find(
          (x) => x.atorId === atorId,
        ),
      ).toMatchObject({
        maiorSequencia10Min: 10,
      });
      expect((r.body.foraDoHorario as { atorId: string }[]).map((x) => x.atorId)).toContain(
        madrugadaId,
      );
    });

    it('saúde do sistema', async () => {
      const r = await get('/plataforma/saude', t.semPermissao).expect(200);
      expect(r.body).toMatchObject({
        status: 'ok',
        servicos: { banco: { status: 'up' }, storage: { status: 'up' } },
      });
    });
  });
});
