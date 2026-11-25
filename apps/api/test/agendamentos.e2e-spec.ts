import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { gerarCpf } from '../src/common/utils/cpf.js';
import { dataLocal, localParaUtc, somarDias } from '../src/common/utils/datas.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  criarApp,
  criarCenario,
  criarPrisma,
  SENHA,
  tokenCliente,
  tokenOficina,
  type Cenario,
} from './helpers.js';

/** Dia de teste: 3 dias à frente (todas as oficinas de teste abrem todos os dias). */
const DIA = somarDias(dataLocal(new Date()), 3);
const as = (hhmm: string, dia = DIA) => {
  const [h, m] = hhmm.split(':').map(Number);
  return localParaUtc(dia, h * 60 + m).toISOString();
};

async function abrirTodosOsDias(prisma: PrismaClient, oficinaId: string) {
  for (let diaSemana = 0; diaSemana <= 6; diaSemana++) {
    await prisma.horarioFuncionamento.create({
      data: {
        oficinaId,
        diaSemana,
        abre: '08:00',
        fecha: '18:00',
        intervaloInicio: '12:00',
        intervaloFim: '13:00',
      },
    });
  }
}

interface Solo {
  oficinaId: string;
  masterId: string;
  masterEmail: string;
  clientes: { id: string; email: string; veiculoId: string }[];
}

/** Oficina com um único mecânico (o master) e três clientes com veículo. */
async function criarOficinaSolo(prisma: PrismaClient): Promise<Solo> {
  const senhaHash = await argon2.hash(SENHA);
  const plano = await prisma.plano.findFirstOrThrow({ where: { nome: 'Oficina' } });
  const oficina = await prisma.oficina.create({
    data: { nome: `Solo ${randomUUID().slice(0, 6)}`, planoId: plano.id, status: 'ATIVA' },
  });
  await abrirTodosOsDias(prisma, oficina.id);
  const masterEmail = `solo-${randomUUID().slice(0, 8)}@teste.local`;
  const master = await prisma.user.create({
    data: { oficinaId: oficina.id, nome: 'Solo', email: masterEmail, senhaHash, role: 'MASTER' },
  });
  const clientes = [];
  for (let i = 0; i < 3; i++) {
    const email = `cli-solo-${randomUUID().slice(0, 8)}@teste.local`;
    const cliente = await prisma.cliente.create({
      data: {
        nome: `Cliente ${i}`,
        cpf: gerarCpf(),
        email,
        senhaHash,
        consentimentoLgpdEm: new Date(),
      },
    });
    await prisma.clienteOficina.create({ data: { clienteId: cliente.id, oficinaId: oficina.id } });
    const veiculo = await prisma.veiculo.create({
      data: { clienteId: cliente.id, placa: `SOL${i}A2${i}` },
    });
    clientes.push({ id: cliente.id, email, veiculoId: veiculo.id });
  }
  return { oficinaId: oficina.id, masterId: master.id, masterEmail, clientes };
}

describe('Agendamentos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  let solo: Solo;
  let tokCli: string[];
  let tokSolo: string;

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    await abrirTodosOsDias(prisma, c.a.id);
    solo = await criarOficinaSolo(prisma);
    tokCli = [];
    for (const cli of solo.clientes) tokCli.push(await tokenCliente(app, cli.email));
    tokSolo = await tokenOficina(app, solo.masterEmail);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const agendar = (i: number, inicio: string, extra: Record<string, unknown> = {}) =>
    http()
      .post('/cliente/agendamentos')
      .auth(tokCli[i], { type: 'bearer' })
      .send({
        oficinaId: solo.oficinaId,
        veiculoId: solo.clientes[i].veiculoId,
        inicio,
        tipoServico: 'Revisão',
        ...extra,
      });
  const horasLivres = async (dia = DIA) => {
    const r = await http()
      .get(`/cliente/oficinas/${solo.oficinaId}/disponibilidade?data=${dia}`)
      .auth(tokCli[0], { type: 'bearer' })
      .expect(200);
    return (r.body[0].horarios as { hora: string }[]).map((h) => h.hora);
  };

  describe('critério da fase: não permite conflito de horário', () => {
    it('disponibilidade: grade de 30 em 30 min, sem almoço', async () => {
      const horas = await horasLivres();
      expect(horas).toHaveLength(16);
      expect(horas).toContain('11:00');
      expect(horas).not.toContain('11:30');
      expect(horas).not.toContain('12:00');
    });

    it('cliente agenda; o mesmo horário e horários sobrepostos ficam indisponíveis', async () => {
      const r = await agendar(0, as('09:00')).expect(201);
      expect(r.body).toMatchObject({ status: 'AGENDADO', tipoServico: 'Revisão' });
      expect(new Date(r.body.fim as string).toISOString()).toBe(as('10:00'));

      const conflito = await agendar(1, as('09:00')).expect(409);
      expect(conflito.body.codigo).toBe('HORARIO_INDISPONIVEL');
      await agendar(1, as('09:30')).expect(409);
      await agendar(1, as('08:30')).expect(409);
      await agendar(1, as('10:00')).expect(201);

      const horas = await horasLivres();
      for (const h of ['08:30', '09:00', '09:30', '10:00']) expect(horas).not.toContain(h);
      expect(horas).toContain('08:00');
    });

    it('pedidos simultâneos para o mesmo horário: só um passa', async () => {
      const respostas = await Promise.all([0, 1, 2, 0, 1].map((i) => agendar(i, as('14:00'))));
      const status = respostas.map((r) => r.status).sort();
      expect(status).toEqual([201, 409, 409, 409, 409]);
      const noBanco = await prisma.agendamento.count({
        where: { oficinaId: solo.oficinaId, inicio: new Date(as('14:00')), status: 'AGENDADO' },
      });
      expect(noBanco).toBe(1);
    });

    it('recusa fora da grade, fora do expediente, no almoço e no passado', async () => {
      await agendar(2, as('15:10')).expect(409);
      const fora = await agendar(2, as('07:00')).expect(400);
      expect(fora.body.codigo).toBe('FORA_DO_EXPEDIENTE');
      await agendar(2, as('11:30')).expect(400);
      await agendar(2, as('17:30')).expect(400);
      const passado = await agendar(
        2,
        as('09:00', dataLocal(new Date(Date.now() - 86_400_000))),
      ).expect(400);
      expect(passado.body.codigo).toBe('HORARIO_NO_PASSADO');
    });

    it('oficina agenda em horário livre fora da grade, mas também sem conflito', async () => {
      const r = await http()
        .post('/oficina/agendamentos')
        .auth(tokSolo, { type: 'bearer' })
        .send({
          clienteId: solo.clientes[2].id,
          veiculoId: solo.clientes[2].veiculoId,
          inicio: as('15:15'),
          duracaoMin: 45,
          tipoServico: 'Troca de óleo',
          mecanicoId: solo.masterId,
        })
        .expect(201);
      expect(r.body).toMatchObject({ status: 'CONFIRMADO', mecanico: { id: solo.masterId } });
      await agendar(2, as('15:30')).expect(409);
      await agendar(2, as('16:00')).expect(201);
    });

    it('o banco também barra o mesmo mecânico em horários sobrepostos', async () => {
      const base = {
        oficinaId: solo.oficinaId,
        clienteId: solo.clientes[0].id,
        veiculoId: solo.clientes[0].veiculoId,
        mecanicoId: solo.masterId,
        tipoServico: 'x',
        criadoPorTipo: 'SISTEMA' as const,
        criadoPorId: 'teste',
        status: 'CONFIRMADO' as const,
      };
      const dia = somarDias(DIA, 1);
      await prisma.agendamento.create({
        data: { ...base, inicio: as('08:00', dia), fim: as('09:00', dia) },
      });
      await expect(
        prisma.agendamento.create({
          data: { ...base, inicio: as('08:30', dia), fim: as('09:30', dia) },
        }),
      ).rejects.toThrow();
    });
  });

  describe('cliente: reagendar e cancelar', () => {
    it('reagenda para horário livre e o antigo é liberado; cancela', async () => {
      const dia = somarDias(DIA, 2);
      const r = await agendar(0, as('10:00', dia)).expect(201);
      const id = r.body.id as string;

      await http()
        .patch(`/cliente/agendamentos/${id}/reagendar`)
        .auth(tokCli[0], { type: 'bearer' })
        .send({ inicio: as('13:00', dia) })
        .expect(200);
      expect(await horasLivres(dia)).toContain('10:00');
      expect(await horasLivres(dia)).not.toContain('13:00');

      const cancel = await http()
        .patch(`/cliente/agendamentos/${id}/cancelar`)
        .auth(tokCli[0], { type: 'bearer' })
        .send({ motivo: 'Imprevisto' })
        .expect(200);
      expect(cancel.body).toMatchObject({ status: 'CANCELADO', motivoCancelamento: 'Imprevisto' });
      expect(await horasLivres(dia)).toContain('13:00');
    });

    it('depois do prazo (padrão 2h antes) não pode mais reagendar nem cancelar', async () => {
      const inicio = new Date(Date.now() + 60 * 60_000);
      const ag = await prisma.agendamento.create({
        data: {
          oficinaId: solo.oficinaId,
          clienteId: solo.clientes[1].id,
          veiculoId: solo.clientes[1].veiculoId,
          tipoServico: 'x',
          inicio,
          fim: new Date(inicio.getTime() + 3_600_000),
          criadoPorTipo: 'CLIENTE',
          criadoPorId: solo.clientes[1].id,
        },
      });
      const r = await http()
        .patch(`/cliente/agendamentos/${ag.id}/cancelar`)
        .auth(tokCli[1], { type: 'bearer' })
        .send({})
        .expect(422);
      expect(r.body.codigo).toBe('PRAZO_ENCERRADO');
      await http()
        .patch(`/cliente/agendamentos/${ag.id}/reagendar`)
        .auth(tokCli[1], { type: 'bearer' })
        .send({ inicio: as('16:30') })
        .expect(422);
    });

    it('cliente não mexe em agendamento de outro cliente', async () => {
      const r = await agendar(2, as('08:00', somarDias(DIA, 4))).expect(201);
      await http()
        .patch(`/cliente/agendamentos/${r.body.id as string}/cancelar`)
        .auth(tokCli[0], { type: 'bearer' })
        .send({})
        .expect(404);
      await http()
        .get(`/cliente/agendamentos/${r.body.id as string}`)
        .auth(tokCli[0], { type: 'bearer' })
        .expect(404);
    });

    it('cliente não agenda em oficina à qual não está vinculado nem com veículo de outro', async () => {
      await http()
        .get(`/cliente/oficinas/${c.b.id}/disponibilidade?data=${DIA}`)
        .auth(tokCli[0], { type: 'bearer' })
        .expect(404);
      await agendar(0, as('16:30'), { veiculoId: solo.clientes[1].veiculoId }).expect(404);
    });
  });

  describe('oficina com vários mecânicos (A: master + 3 mecânicos)', () => {
    let master: string;
    let mecanico: string;
    let gerente: string;
    let veiculoId: string;
    const D = somarDias(DIA, 5);

    beforeAll(async () => {
      master = await tokenOficina(app, c.a.master.email);
      mecanico = await tokenOficina(app, c.a.mecanico.email);
      gerente = await tokenOficina(app, c.a.mecanicoGerente.email);
      veiculoId = (
        await prisma.veiculo.create({ data: { clienteId: c.cliente.id, placa: 'MUL1T23' } })
      ).id;
    });

    const criar = (token: string, inicio: string, extra: Record<string, unknown> = {}) =>
      http()
        .post('/oficina/agendamentos')
        .auth(token, { type: 'bearer' })
        .send({ clienteId: c.cliente.id, veiculoId, inicio, tipoServico: 'Diagnóstico', ...extra });

    it('cabe um atendimento sem mecânico por mecânico ativo', async () => {
      for (let i = 0; i < 4; i++) await criar(master, as('09:00', D)).expect(201);
      await criar(master, as('09:00', D)).expect(409);
      await criar(master, as('10:00', D)).expect(201);
    });

    it('mecânico comum vê só a própria agenda; gerente vê tudo', async () => {
      const r = await criar(master, as('14:00', D)).expect(201);
      const id = r.body.id as string;

      const antes = await http()
        .get(`/oficina/agendamentos?de=${D}&ate=${D}`)
        .auth(mecanico, { type: 'bearer' })
        .expect(200);
      expect(antes.body).toEqual([]);
      await http()
        .get(`/oficina/agendamentos/${id}`)
        .auth(mecanico, { type: 'bearer' })
        .expect(404);

      const doGerente = await http()
        .get(`/oficina/agendamentos?de=${D}&ate=${D}`)
        .auth(gerente, { type: 'bearer' })
        .expect(200);
      expect((doGerente.body as unknown[]).length).toBeGreaterThanOrEqual(6);

      await http()
        .patch(`/oficina/agendamentos/${id}/mecanico`)
        .auth(master, { type: 'bearer' })
        .send({ mecanicoId: c.a.mecanico.id })
        .expect(200);
      const depois = await http()
        .get(`/oficina/agendamentos?de=${D}&ate=${D}`)
        .auth(mecanico, { type: 'bearer' })
        .expect(200);
      expect((depois.body as { id: string }[]).map((a) => a.id)).toEqual([id]);

      const agenda = await http()
        .get(`/oficina/agenda?data=${D}`)
        .auth(mecanico, { type: 'bearer' })
        .expect(200);
      expect(agenda.body.mecanicos).toHaveLength(1);
      expect(agenda.body.mecanicos[0].agendamentos).toHaveLength(1);
      expect(agenda.body.semMecanico).toEqual([]);

      const agendaMaster = await http()
        .get(`/oficina/agenda?data=${D}`)
        .auth(master, { type: 'bearer' })
        .expect(200);
      expect(agendaMaster.body.mecanicos).toHaveLength(4);
      expect((agendaMaster.body.semMecanico as unknown[]).length).toBeGreaterThanOrEqual(5);
    });

    it('mecânico comum só assume para si e só agenda para si', async () => {
      const r = await criar(master, as('16:00', D)).expect(201);
      const id = r.body.id as string;
      await http()
        .patch(`/oficina/agendamentos/${id}/mecanico`)
        .auth(mecanico, { type: 'bearer' })
        .send({ mecanicoId: c.a.mecanicoLogs.id })
        .expect(403);
      await http()
        .patch(`/oficina/agendamentos/${id}/mecanico`)
        .auth(mecanico, { type: 'bearer' })
        .send({ mecanicoId: c.a.mecanico.id })
        .expect(200);

      const proprio = await criar(mecanico, as('08:00', D)).expect(201);
      expect(proprio.body.mecanico.id).toBe(c.a.mecanico.id);
      await criar(mecanico, as('08:00', somarDias(D, 1)), { mecanicoId: c.a.master.id }).expect(
        403,
      );
    });

    it('não atribui mecânico ocupado no horário', async () => {
      const a1 = await criar(master, as('15:00', D), { mecanicoId: c.a.mecanicoLogs.id }).expect(
        201,
      );
      const a2 = await criar(master, as('15:00', D)).expect(201);
      const r = await http()
        .patch(`/oficina/agendamentos/${a2.body.id as string}/mecanico`)
        .auth(master, { type: 'bearer' })
        .send({ mecanicoId: c.a.mecanicoLogs.id })
        .expect(409);
      expect(r.body.codigo).toBe('MECANICO_OCUPADO');
      expect(a1.body.mecanico.id).toBe(c.a.mecanicoLogs.id);
    });

    it('fluxo de status e transições inválidas', async () => {
      const r = await criar(master, as('17:00', D)).expect(201);
      const id = r.body.id as string;
      const mudar = (status: string) =>
        http()
          .patch(`/oficina/agendamentos/${id}/status`)
          .auth(master, { type: 'bearer' })
          .send({ status });
      await mudar('EM_ATENDIMENTO').expect(200);
      await mudar('CONFIRMADO').expect(422);
      await mudar('CONCLUIDO').expect(200);
      const inv = await mudar('CANCELADO').expect(422);
      expect(inv.body.codigo).toBe('TRANSICAO_INVALIDA');
    });

    it('agendamento da oficina A é invisível para a B e o vínculo do veículo é criado', async () => {
      const masterB = await tokenOficina(app, c.b.master.email);
      const r = await criar(master, as('11:00', D)).expect(201);
      await http()
        .get(`/oficina/agendamentos/${r.body.id as string}`)
        .auth(masterB, { type: 'bearer' })
        .expect(404);
      await http()
        .patch(`/oficina/agendamentos/${r.body.id as string}/status`)
        .auth(masterB, { type: 'bearer' })
        .send({ status: 'CANCELADO' })
        .expect(404);
      await http()
        .get(`/oficina/veiculos/${veiculoId}`)
        .auth(master, { type: 'bearer' })
        .expect(200);
      await http()
        .get(`/oficina/veiculos/${veiculoId}`)
        .auth(masterB, { type: 'bearer' })
        .expect(404);
    });

    it('auditoria registra o agendamento com o ator', async () => {
      const log = await prisma.auditLog.findFirst({
        where: {
          acao: 'AGENDAMENTO_CRIADO_PELA_OFICINA',
          oficinaId: c.a.id,
          atorId: c.a.master.id,
        },
      });
      expect(log).toMatchObject({ entidade: 'Agendamento', atorTipo: 'USUARIO' });
      // O vínculo do veículo criado junto fica com o nome padrão.
      const vinculo = await prisma.auditLog.findFirst({
        where: { entidade: 'VeiculoOficina', oficinaId: c.a.id, atorId: c.a.master.id },
      });
      expect(vinculo?.acao).toBe('VEICULO_OFICINA_SALVO');
    });
  });
});
