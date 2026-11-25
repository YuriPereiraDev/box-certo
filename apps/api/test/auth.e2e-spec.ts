import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { TotpService } from '../src/auth/totp.service.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  criarApp,
  criarCenario,
  criarPrisma,
  SENHA,
  tokenOficina,
  type Cenario,
} from './helpers.js';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('login da oficina', () => {
    it('devolve tokens e o perfil sem segredos', async () => {
      const res = await http()
        .post('/auth/oficina/login')
        .send({ email: c.a.master.email, senha: SENHA })
        .expect(200);
      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiraEmSegundos: 900,
        ator: { tipo: 'USUARIO', id: c.a.master.id, oficinaId: c.a.id, role: 'MASTER' },
      });
      expect(JSON.stringify(res.body)).not.toContain('senhaHash');
    });

    it('senha errada: 401 e registra LOGIN_FALHA', async () => {
      await http()
        .post('/auth/oficina/login')
        .send({ email: c.a.mecanico.email, senha: 'errada' })
        .expect(401);
      const log = await prisma.auditLog.findFirst({
        where: { acao: 'LOGIN_FALHA', atorId: c.a.mecanico.id },
      });
      expect(log).not.toBeNull();
    });

    it('e-mail inexistente: mesma resposta 401', async () => {
      const res = await http()
        .post('/auth/oficina/login')
        .send({ email: 'ninguem@teste.local', senha: SENHA })
        .expect(401);
      expect(res.body.mensagem).toBe('E-mail ou senha inválidos');
    });

    it('oficina suspensa: login e token existente recebem 403 com mensagem clara', async () => {
      const token = await tokenOficina(app, c.b.mecanico.email);
      await prisma.oficina.update({ where: { id: c.b.id }, data: { status: 'SUSPENSA' } });
      try {
        const login = await http()
          .post('/auth/oficina/login')
          .send({ email: c.b.master.email, senha: SENHA })
          .expect(403);
        expect(login.body.codigo).toBe('OFICINA_SUSPENSA');
        expect(login.body.mensagem).toMatch(/suspenso/);

        const me = await http().get('/auth/me').auth(token, { type: 'bearer' }).expect(403);
        expect(me.body.codigo).toBe('OFICINA_SUSPENSA');
      } finally {
        await prisma.oficina.update({ where: { id: c.b.id }, data: { status: 'ATIVA' } });
      }
    });

    it('mesmo e-mail em duas oficinas: pede para escolher e aceita oficinaId', async () => {
      const email = c.a.mecanico.email;
      const { senhaHash } = await prisma.user.findUniqueOrThrow({ where: { id: c.a.mecanico.id } });
      await prisma.user.create({
        data: { oficinaId: c.b.id, nome: 'Duplicado', email, senhaHash, role: 'MECANICO' },
      });

      const escolha = await http()
        .post('/auth/oficina/login')
        .send({ email, senha: SENHA })
        .expect(409);
      expect(escolha.body.codigo).toBe('ESCOLHA_OFICINA');
      expect((escolha.body.oficinas as { id: string }[]).map((o) => o.id).sort()).toEqual(
        [c.a.id, c.b.id].sort(),
      );

      const res = await http()
        .post('/auth/oficina/login')
        .send({ email, senha: SENHA, oficinaId: c.b.id })
        .expect(200);
      expect(res.body.ator.oficinaId).toBe(c.b.id);
    });
  });

  describe('login do cliente', () => {
    it('entra com e-mail ou CPF (com máscara)', async () => {
      await http()
        .post('/auth/cliente/login')
        .send({ login: c.cliente.email, senha: SENHA })
        .expect(200);
      const cpf = c.cliente.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      const res = await http()
        .post('/auth/cliente/login')
        .send({ login: cpf, senha: SENHA })
        .expect(200);
      expect(res.body.ator).toMatchObject({ tipo: 'CLIENTE', id: c.cliente.id });
    });

    it('senha errada: 401', async () => {
      await http()
        .post('/auth/cliente/login')
        .send({ login: c.cliente.email, senha: 'errada' })
        .expect(401);
    });
  });

  describe('login da plataforma com 2FA', () => {
    it('com 2FA ativo exige código válido', async () => {
      const semCodigo = await http()
        .post('/auth/plataforma/login')
        .send({ email: c.dono.email, senha: SENHA })
        .expect(401);
      expect(semCodigo.body.codigo).toBe('TOTP_OBRIGATORIO');

      const errado = await http()
        .post('/auth/plataforma/login')
        .send({ email: c.dono.email, senha: SENHA, codigoTotp: '000000' })
        .expect(401);
      expect(errado.body.codigo).toBe('TOTP_INVALIDO');

      const codigoTotp = app.get(TotpService).gerarCodigo(c.dono.segredoTotp);
      const ok = await http()
        .post('/auth/plataforma/login')
        .send({ email: c.dono.email, senha: SENHA, codigoTotp })
        .expect(200);
      expect(ok.body.ator).toMatchObject({ tipo: 'PLATAFORMA', isOwner: true });
    });

    it('primeiro login: configura e ativa o 2FA antes de liberar tokens', async () => {
      const { senhaHash } = await prisma.platformAdmin.findUniqueOrThrow({
        where: { id: c.dono.id },
      });
      const email = `novo-admin-${Date.now()}@teste.local`;
      await prisma.platformAdmin.create({
        data: { nome: 'Novo admin', email, senhaHash, permissoes: [] },
      });

      const login = await http()
        .post('/auth/plataforma/login')
        .send({ email, senha: SENHA })
        .expect(200);
      expect(login.body).toEqual({
        requerConfiguracao2fa: true,
        tokenConfiguracao: expect.any(String),
      });
      const { tokenConfiguracao } = login.body as { tokenConfiguracao: string };

      // O token de configuração não serve como token de acesso.
      await http().get('/auth/me').auth(tokenConfiguracao, { type: 'bearer' }).expect(401);

      const config = await http()
        .post('/auth/plataforma/2fa/configurar')
        .send({ tokenConfiguracao })
        .expect(200);
      expect(config.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Box%20Certo/);
      const segredo = config.body.segredo as string;

      const salvo = await prisma.platformAdmin.findUniqueOrThrow({ where: { email } });
      expect(salvo.totpSecret).not.toContain(segredo); // guardado criptografado

      await http()
        .post('/auth/plataforma/2fa/ativar')
        .send({ tokenConfiguracao, codigo: '000000' })
        .expect(401);

      const codigo = app.get(TotpService).gerarCodigo(segredo);
      const ativado = await http()
        .post('/auth/plataforma/2fa/ativar')
        .send({ tokenConfiguracao, codigo })
        .expect(200);
      expect(ativado.body.accessToken).toEqual(expect.any(String));

      // Depois de ativo, o login passa a exigir o código.
      const depois = await http()
        .post('/auth/plataforma/login')
        .send({ email, senha: SENHA })
        .expect(401);
      expect(depois.body.codigo).toBe('TOTP_OBRIGATORIO');
    });
  });

  describe('refresh e logout', () => {
    const login = async (): Promise<Tokens> =>
      (
        await http()
          .post('/auth/oficina/login')
          .send({ email: c.a.mecanicoGerente.email, senha: SENHA })
          .expect(200)
      ).body as Tokens;

    it('refresh rotativo: devolve par novo e o antigo deixa de valer', async () => {
      const t1 = await login();
      const r = await http()
        .post('/auth/refresh')
        .send({ refreshToken: t1.refreshToken })
        .expect(200);
      const t2 = r.body as Tokens;
      expect(t2.refreshToken).not.toBe(t1.refreshToken);
      await http().get('/auth/me').auth(t2.accessToken, { type: 'bearer' }).expect(200);

      // Reuso do antigo: 401 e todas as sessões do usuário são revogadas.
      await http().post('/auth/refresh').send({ refreshToken: t1.refreshToken }).expect(401);
      await http().post('/auth/refresh').send({ refreshToken: t2.refreshToken }).expect(401);
      const log = await prisma.auditLog.findFirst({
        where: { acao: 'REFRESH_TOKEN_REUTILIZADO', atorId: c.a.mecanicoGerente.id },
      });
      expect(log).not.toBeNull();
    });

    it('refresh token é salvo só como hash', async () => {
      const t = await login();
      const emClaro = await prisma.refreshToken.findFirst({ where: { hash: t.refreshToken } });
      expect(emClaro).toBeNull();
    });

    it('logout revoga o refresh token', async () => {
      const t = await login();
      await http().post('/auth/logout').send({ refreshToken: t.refreshToken }).expect(204);
      await http().post('/auth/refresh').send({ refreshToken: t.refreshToken }).expect(401);
    });

    it('refresh inválido: 401', async () => {
      await http().post('/auth/refresh').send({ refreshToken: 'nao-existe' }).expect(401);
    });
  });
});
