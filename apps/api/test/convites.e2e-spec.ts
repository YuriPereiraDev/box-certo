import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { gerarCpf } from '../src/common/utils/cpf.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  criarApp,
  criarCenario,
  criarPrisma,
  SENHA,
  tokenOficina,
  type Cenario,
} from './helpers.js';

interface ConviteResp {
  id: string;
  codigo: string;
  link: string;
  individual: boolean;
  maxUsos: number | null;
  expiraEm: string | null;
}

const dadosCliente = (sobrescrever: Record<string, unknown> = {}) => ({
  nome: 'Joana Cliente',
  cpf: gerarCpf(),
  dataNascimento: '1990-05-20',
  email: `joana-${Math.random().toString(36).slice(2, 10)}@teste.local`,
  telefone: '(11) 98888-7777',
  cep: '01310-100',
  rua: 'Av. Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
  senha: SENHA,
  aceiteLgpd: true,
  ...sobrescrever,
});

/** Seção 7.1 — critério da fase 2: cliente se cadastra por convite e aparece só na oficina certa. */
describe('Convites e cadastro do cliente (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  let masterA: string;
  let masterB: string;
  let mecanicoA: string;

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    masterA = await tokenOficina(app, c.a.master.email);
    masterB = await tokenOficina(app, c.b.master.email);
    mecanicoA = await tokenOficina(app, c.a.mecanico.email);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const criarConvite = async (token: string, corpo: Record<string, unknown> = {}) =>
    (await http().post('/oficina/convites').auth(token, { type: 'bearer' }).send(corpo).expect(201))
      .body as ConviteResp;

  it('fluxo completo: convite → cadastro → cliente aparece só na oficina A', async () => {
    const convite = await criarConvite(mecanicoA);
    expect(convite.codigo).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(convite.link).toMatch(new RegExp(`/convite/${convite.codigo}$`));
    expect(convite.maxUsos).toBeNull(); // convite geral

    const info = await http().get(`/publico/convites/${convite.codigo.toLowerCase()}`).expect(200);
    expect(info.body.oficina.nome).toMatch(/^Oficina A/);

    const dados = dadosCliente();
    const cad = await http()
      .post(`/publico/convites/${convite.codigo}/cadastro`)
      .send(dados)
      .expect(201);
    expect(cad.body.ator).toMatchObject({ tipo: 'CLIENTE', nome: 'Joana Cliente' });
    const clienteId = cad.body.ator.id as string;

    // Dados normalizados e consentimento LGPD gravado.
    const salvo = await prisma.cliente.findUniqueOrThrow({ where: { id: clienteId } });
    expect(salvo.cpf).toBe(dados.cpf);
    expect(salvo.telefone).toBe('11988887777');
    expect(salvo.cep).toBe('01310100');
    expect(salvo.consentimentoLgpdEm).toBeInstanceOf(Date);

    // Oficina A vê o cliente; oficina B não.
    const listaA = await http()
      .get('/oficina/clientes')
      .auth(masterA, { type: 'bearer' })
      .expect(200);
    expect((listaA.body as { id: string }[]).map((x) => x.id)).toContain(clienteId);
    const listaB = await http()
      .get('/oficina/clientes')
      .auth(masterB, { type: 'bearer' })
      .expect(200);
    expect((listaB.body as { id: string }[]).map((x) => x.id)).not.toContain(clienteId);
    await http()
      .get(`/oficina/clientes/${clienteId}`)
      .auth(masterB, { type: 'bearer' })
      .expect(404);

    // O cliente vê só a oficina A.
    const minhas = await http()
      .get('/cliente/oficinas')
      .auth(cad.body.accessToken as string, { type: 'bearer' })
      .expect(200);
    expect((minhas.body as { id: string }[]).map((o) => o.id)).toEqual([c.a.id]);

    // Uso contado e auditado.
    const conv = await prisma.convite.findUniqueOrThrow({ where: { id: convite.id } });
    expect(conv.usos).toBe(1);
    const log = await prisma.auditLog.findFirst({
      where: { acao: 'CLIENTE_CADASTRADO_POR_CONVITE', atorId: clienteId },
    });
    expect(log).toMatchObject({ atorTipo: 'CLIENTE' });
  });

  it('cliente que já tem conta: 409 no cadastro e vínculo pelo login', async () => {
    const convite = await criarConvite(masterB);
    const dup = await http()
      .post(`/publico/convites/${convite.codigo}/cadastro`)
      .send(dadosCliente({ cpf: c.cliente.cpf }))
      .expect(409);
    expect(dup.body.codigo).toBe('CLIENTE_JA_CADASTRADO');

    const vinc = await http()
      .post(`/publico/convites/${convite.codigo}/vincular`)
      .send({ login: c.cliente.email, senha: SENHA })
      .expect(201);
    expect(vinc.body.vinculoCriado).toBe(true);

    const minhas = await http()
      .get('/cliente/oficinas')
      .auth(vinc.body.accessToken as string, { type: 'bearer' })
      .expect(200);
    expect((minhas.body as { id: string }[]).map((o) => o.id).sort()).toEqual(
      [c.a.id, c.b.id].sort(),
    );

    // Vincular de novo não duplica nem consome uso.
    const again = await http()
      .post(`/publico/convites/${convite.codigo}/vincular`)
      .send({ login: c.cliente.cpf, senha: SENHA })
      .expect(201);
    expect(again.body.vinculoCriado).toBe(false);
    expect((await prisma.convite.findUniqueOrThrow({ where: { id: convite.id } })).usos).toBe(1);
  });

  it('vincular com senha errada: 401 e não cria vínculo', async () => {
    const outra = await prisma.oficina.create({
      data: {
        nome: 'Oficina C',
        planoId: (await prisma.plano.findFirstOrThrow()).id,
        status: 'ATIVA',
      },
    });
    const conv = await prisma.convite.create({
      data: {
        oficinaId: outra.id,
        codigo: `V${Date.now().toString(36).slice(-5).toUpperCase()}`,
        criadoPorId: c.a.master.id,
      },
    });
    await http()
      .post(`/publico/convites/${conv.codigo}/vincular`)
      .send({ login: c.cliente.email, senha: 'errada' })
      .expect(401);
    const vinculo = await prisma.clienteOficina.findUnique({
      where: { clienteId_oficinaId: { clienteId: c.cliente.id, oficinaId: outra.id } },
    });
    expect(vinculo).toBeNull();
  });

  it('convite individual vale uma vez; depois 410 CONVITE_ESGOTADO', async () => {
    const convite = await criarConvite(masterA, {
      individual: true,
      nome: 'Pedro',
      telefone: '11977776666',
    });
    expect(convite.maxUsos).toBe(1);
    expect(convite.expiraEm).not.toBeNull();

    const info = await http().get(`/publico/convites/${convite.codigo}`).expect(200);
    expect(info.body).toMatchObject({ individual: true, nome: 'Pedro', telefone: '11977776666' });

    await http()
      .post(`/publico/convites/${convite.codigo}/cadastro`)
      .send(dadosCliente())
      .expect(201);
    const esgotado = await http()
      .post(`/publico/convites/${convite.codigo}/cadastro`)
      .send(dadosCliente())
      .expect(410);
    expect(esgotado.body.codigo).toBe('CONVITE_ESGOTADO');
  });

  it('convite expirado, desativado ou inexistente: mensagem clara', async () => {
    const expirado = await criarConvite(masterA);
    await prisma.convite.update({
      where: { id: expirado.id },
      data: { expiraEm: new Date(Date.now() - 1000) },
    });
    const r1 = await http().get(`/publico/convites/${expirado.codigo}`).expect(410);
    expect(r1.body.codigo).toBe('CONVITE_EXPIRADO');
    expect(r1.body.mensagem).toMatch(/expirou/);

    const inativo = await criarConvite(masterA);
    await http()
      .patch(`/oficina/convites/${inativo.id}/desativar`)
      .auth(masterA, { type: 'bearer' })
      .expect(200);
    const r2 = await http().get(`/publico/convites/${inativo.codigo}`).expect(410);
    expect(r2.body.codigo).toBe('CONVITE_INATIVO');

    const r3 = await http().get('/publico/convites/ZZZZZZ').expect(404);
    expect(r3.body.codigo).toBe('CONVITE_NAO_ENCONTRADO');
  });

  it('valida CPF, e-mail e aceite LGPD no cadastro', async () => {
    const convite = await criarConvite(masterA);
    const res = await http()
      .post(`/publico/convites/${convite.codigo}/cadastro`)
      .send(dadosCliente({ cpf: '111.111.111-11', email: 'invalido', aceiteLgpd: false }))
      .expect(400);
    const msgs = (res.body.mensagem as string[]).join(' | ');
    expect(msgs).toMatch(/CPF inválido/);
    expect(msgs).toMatch(/E-mail inválido/);
    expect(msgs).toMatch(/aceitar os termos/);
  });

  it('oficina suspensa não aceita cadastro pelo convite', async () => {
    const convite = await criarConvite(masterB);
    await prisma.oficina.update({ where: { id: c.b.id }, data: { status: 'SUSPENSA' } });
    try {
      const r = await http().get(`/publico/convites/${convite.codigo}`).expect(410);
      expect(r.body.codigo).toBe('OFICINA_INDISPONIVEL');
    } finally {
      await prisma.oficina.update({ where: { id: c.b.id }, data: { status: 'ATIVA' } });
    }
  });

  describe('gestão de convites na oficina', () => {
    it('convites de outra oficina: 404', async () => {
      const deA = await criarConvite(masterA);
      await http().get(`/oficina/convites/${deA.id}`).auth(masterB, { type: 'bearer' }).expect(404);
      await http()
        .patch(`/oficina/convites/${deA.id}/desativar`)
        .auth(masterB, { type: 'bearer' })
        .expect(404);
      const lista = await http()
        .get('/oficina/convites')
        .auth(masterB, { type: 'bearer' })
        .expect(200);
      expect((lista.body as { id: string }[]).map((x) => x.id)).not.toContain(deA.id);
    });

    it('mecânico comum só desativa os convites que ele mesmo criou', async () => {
      const doMaster = await criarConvite(masterA);
      await http()
        .patch(`/oficina/convites/${doMaster.id}/desativar`)
        .auth(mecanicoA, { type: 'bearer' })
        .expect(403);
      const doMecanico = await criarConvite(mecanicoA);
      await http()
        .patch(`/oficina/convites/${doMecanico.id}/desativar`)
        .auth(mecanicoA, { type: 'bearer' })
        .expect(200);
    });

    it('gera QR code PNG do link', async () => {
      const convite = await criarConvite(masterA);
      const res = await http()
        .get(`/oficina/convites/${convite.id}/qrcode`)
        .auth(masterA, { type: 'bearer' })
        .buffer(true)
        .parse((r, cb) => {
          const partes: Buffer[] = [];
          r.on('data', (p: Buffer) => partes.push(p));
          r.on('end', () => cb(null, Buffer.concat(partes)));
        })
        .expect(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect((res.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
    });
  });
});
