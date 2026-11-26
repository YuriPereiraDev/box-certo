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

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** Início de um MP4 (caixa ftyp "isom") + bytes de conteúdo. */
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from('isomiso2'),
  Buffer.alloc(2048, 7),
]);

interface TicketResp {
  id: string;
  numero: number;
  status: string;
  mensagens: { autorTipo: string; autorNome: string; texto: string; interna?: boolean }[];
  anexos: { id: string; mime: string; url: string }[];
}

describe('Tickets (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  const t: Record<string, string> = {};

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    t.mecanico = await tokenOficina(app, c.a.mecanico.email);
    t.outroMecanico = await tokenOficina(app, c.a.mecanicoGerente.email);
    t.master = await tokenOficina(app, c.a.master.email);
    t.masterB = await tokenOficina(app, c.b.master.email);
    t.cliente = await tokenCliente(app, c.cliente.email);
    t.dono = await tokenAdmin(app, c.dono); // dono tem tudo, inclusive SUPORTE
    t.adminSemSuporte = await tokenAdmin(app, c.adminGestaoAdmins);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const abrir = (token: string, corpo: Record<string, unknown> = {}) =>
    http()
      .post('/tickets')
      .auth(token, { type: 'bearer' })
      .send({
        tipo: 'ERRO',
        titulo: 'Não consigo enviar o orçamento',
        descricao: 'Aparece erro ao tocar em Enviar',
        contexto: {
          versaoApp: '1.0.0',
          aparelho: 'Moto G',
          sistema: 'Android 14',
          rota: '/oficina/ordens-servico/enviar',
        },
        ...corpo,
      });
  const anexar = (
    token: string,
    id: string,
    conteudo: Buffer,
    nome: string,
    tipo: string,
    base = '/tickets',
  ) =>
    http()
      .post(`${base}/${id}/anexos`)
      .auth(token, { type: 'bearer' })
      .attach('arquivo', conteudo, { filename: nome, contentType: tipo });
  const ver = async (token: string, id: string) =>
    (await http().get(`/tickets/${id}`).auth(token, { type: 'bearer' }).expect(200))
      .body as TicketResp;

  describe('critério da fase: anexos salvos no storage S3', () => {
    it('foto e vídeo vão para o bucket e voltam idênticos pela URL assinada', async () => {
      const r = await abrir(t.mecanico).expect(201);
      const id = r.body.id as string;
      expect(r.body.numero).toEqual(expect.any(Number));

      const foto = await anexar(t.mecanico, id, PNG, 'tela.png', 'image/png').expect(201);
      const video = await anexar(t.mecanico, id, MP4, 'gravacao.mp4', 'video/mp4').expect(201);
      expect(foto.body.mime).toBe('image/png');
      expect(video.body.mime).toBe('video/mp4');

      for (const [anexo, original] of [
        [foto.body, PNG],
        [video.body, MP4],
      ] as const) {
        const baixado = await fetch(anexo.url as string);
        expect(baixado.status).toBe(200);
        expect(Buffer.from(await baixado.arrayBuffer()).equals(original)).toBe(true);
      }
      const registros = await prisma.arquivo.findMany({
        where: { entidade: 'TICKET', entidadeId: id },
      });
      expect(registros).toHaveLength(2);
      expect(
        registros.every((a) => a.chave.startsWith(`tickets/${id}/`) && a.oficinaId === c.a.id),
      ).toBe(true);
      expect((await ver(t.mecanico, id)).anexos).toHaveLength(2);
    });

    it('cliente (sem oficina) também anexa', async () => {
      const r = await abrir(t.cliente, {
        tipo: 'DUVIDA',
        titulo: 'Como aprovo só parte do orçamento?',
      }).expect(201);
      const a = await anexar(t.cliente, r.body.id as string, PNG, 'print.png', 'image/png').expect(
        201,
      );
      const reg = await prisma.arquivo.findUniqueOrThrow({ where: { id: a.body.id as string } });
      expect(reg.oficinaId).toBeNull();
    });

    it('limite de 5 anexos e só foto ou vídeo de verdade', async () => {
      const r = await abrir(t.mecanico).expect(201);
      const id = r.body.id as string;
      const falso = await anexar(
        t.mecanico,
        id,
        Buffer.from('não sou vídeo, sou texto qualquer'),
        'video.mp4',
        'video/mp4',
      ).expect(400);
      expect(falso.body.mensagem).toMatch(/Formato não aceito/);
      for (let i = 0; i < 5; i++)
        await anexar(t.mecanico, id, PNG, `f${i}.png`, 'image/png').expect(201);
      const sexto = await anexar(t.mecanico, id, PNG, 'f6.png', 'image/png').expect(400);
      expect(sexto.body.mensagem).toMatch(/5 anexos/);
    });
  });

  describe('quem vê o ticket', () => {
    let id: string;

    beforeAll(async () => {
      id = (await abrir(t.mecanico, { tipo: 'SUGESTAO', titulo: 'Agenda por semana' }).expect(201))
        .body.id as string;
    });

    it('quem abriu e o master da mesma oficina; mais ninguém', async () => {
      await ver(t.mecanico, id);
      const doMaster = await http().get('/tickets').auth(t.master, { type: 'bearer' }).expect(200);
      expect((doMaster.body as { id: string }[]).map((x) => x.id)).toContain(id);
      await http()
        .post(`/tickets/${id}/mensagens`)
        .auth(t.master, { type: 'bearer' })
        .send({ texto: 'Também quero isso' })
        .expect(201);

      await http().get(`/tickets/${id}`).auth(t.outroMecanico, { type: 'bearer' }).expect(404);
      await http().get(`/tickets/${id}`).auth(t.masterB, { type: 'bearer' }).expect(404);
      await http().get(`/tickets/${id}`).auth(t.cliente, { type: 'bearer' }).expect(404);
      await anexar(t.outroMecanico, id, PNG, 'x.png', 'image/png').expect(404);
      const lista = await http()
        .get('/tickets')
        .auth(t.outroMecanico, { type: 'bearer' })
        .expect(200);
      expect((lista.body as { id: string }[]).map((x) => x.id)).not.toContain(id);
    });

    it('ticket de cliente não aparece para o master', async () => {
      const doCliente = (await abrir(t.cliente).expect(201)).body.id as string;
      await http().get(`/tickets/${doCliente}`).auth(t.master, { type: 'bearer' }).expect(404);
    });

    it('modo suporte não abre ticket', async () => {
      const s = await http()
        .post('/plataforma/suporte/sessoes')
        .auth(t.dono, { type: 'bearer' })
        .send({ oficinaId: c.a.id, motivo: 'teste' })
        .expect(201);
      await abrir(s.body.accessToken as string).expect(403);
    });
  });

  describe('fila do suporte e conversa', () => {
    let id: string;

    beforeAll(async () => {
      id = (
        await abrir(t.mecanico, {
          titulo: `Erro na agenda ${Date.now()}`,
          contexto: { rota: '/oficina/agenda' },
        }).expect(201)
      ).body.id as string;
    });

    it('só admins com SUPORTE acessam a fila', async () => {
      await http()
        .get('/plataforma/tickets')
        .auth(t.adminSemSuporte, { type: 'bearer' })
        .expect(403);
      const fila = await http()
        .get('/plataforma/tickets?limite=200')
        .auth(t.dono, { type: 'bearer' })
        .expect(200);
      expect((fila.body.itens as { id: string }[]).map((x) => x.id)).toContain(id);
      const det = await http()
        .get(`/plataforma/tickets/${id}`)
        .auth(t.dono, { type: 'bearer' })
        .expect(200);
      expect(det.body).toMatchObject({
        autor: { id: c.a.mecanico.id },
        oficina: { id: c.a.id },
        contexto: { rota: '/oficina/agenda' },
      });
    });

    it('nota interna não aparece para o usuário; resposta pública sim, como "Suporte Box Certo"', async () => {
      await http()
        .post(`/plataforma/tickets/${id}/mensagens`)
        .auth(t.dono, { type: 'bearer' })
        .send({ texto: 'Parece o bug da versão 1.0, ver com o time', interna: true })
        .expect(201);
      let visto = await ver(t.mecanico, id);
      expect(visto.status).toBe('ABERTO');
      expect(visto.mensagens).toHaveLength(0);

      const r = await http()
        .post(`/plataforma/tickets/${id}/mensagens`)
        .auth(t.dono, { type: 'bearer' })
        .send({ texto: 'Corrigido na versão 1.0.1. Pode atualizar o app?' })
        .expect(201);
      expect(r.body).toMatchObject({ status: 'RESPONDIDO', atribuidoAId: c.dono.id });
      expect(r.body.primeiraRespostaEm).toEqual(expect.any(String));
      expect(r.body.mensagens).toHaveLength(2);

      visto = await ver(t.mecanico, id);
      expect(visto.mensagens).toEqual([
        expect.objectContaining({ autorTipo: 'PLATAFORMA', autorNome: 'Suporte Box Certo' }),
      ]);
      expect(JSON.stringify(visto)).not.toContain('ver com o time');
    });

    it('usuário responde (volta para análise), suporte resolve, usuário reabre', async () => {
      const r = await http()
        .post(`/tickets/${id}/mensagens`)
        .auth(t.mecanico, { type: 'bearer' })
        .send({ texto: 'Atualizei e continua' })
        .expect(201);
      expect(r.body.status).toBe('EM_ANALISE');
      const resolvido = await http()
        .patch(`/plataforma/tickets/${id}`)
        .auth(t.dono, { type: 'bearer' })
        .send({ status: 'RESOLVIDO', prioridade: 2 })
        .expect(200);
      expect(resolvido.body).toMatchObject({ status: 'RESOLVIDO', prioridade: 2 });
      const reaberto = await http()
        .post(`/tickets/${id}/mensagens`)
        .auth(t.mecanico, { type: 'bearer' })
        .send({ texto: 'Voltou a acontecer' })
        .expect(201);
      expect(reaberto.body.status).toBe('ABERTO');
      await http().post(`/tickets/${id}/resolver`).auth(t.mecanico, { type: 'bearer' }).expect(200);
      expect((await ver(t.mecanico, id)).status).toBe('RESOLVIDO');
    });

    it('só atribui a admin com SUPORTE', async () => {
      await http()
        .patch(`/plataforma/tickets/${id}`)
        .auth(t.dono, { type: 'bearer' })
        .send({ atribuidoAId: c.adminGestaoAdmins.id })
        .expect(400);
    });

    it('indicadores e dashboard da plataforma', async () => {
      const ind = await http()
        .get('/plataforma/tickets/indicadores')
        .auth(t.dono, { type: 'bearer' })
        .expect(200);
      expect(ind.body.abertos).toBeGreaterThan(0);
      expect(ind.body.tempoMedioPrimeiraRespostaMin).toEqual(expect.any(Number));
      expect((ind.body.errosMaisReportados as { rota: string }[]).map((e) => e.rota)).toContain(
        '/oficina/agenda',
      );
      const dash = await http()
        .get('/plataforma/dashboard')
        .auth(t.adminSemSuporte, { type: 'bearer' })
        .expect(200);
      expect(dash.body.tickets).toMatchObject({ abertos: expect.any(Number) });
    });

    it('abertura e respostas ficam na auditoria', async () => {
      const log = await prisma.auditLog.findFirst({
        where: { acao: 'TICKET_ABERTO', entidadeId: id },
      });
      expect(log).toMatchObject({
        atorTipo: 'USUARIO',
        atorId: c.a.mecanico.id,
        oficinaId: c.a.id,
      });
    });
  });
});
