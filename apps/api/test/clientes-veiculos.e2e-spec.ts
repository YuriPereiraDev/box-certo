import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  criarApp,
  criarCenario,
  criarPrisma,
  tokenCliente,
  tokenOficina,
  type Cenario,
} from './helpers.js';

describe('Clientes e veículos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  let masterA: string;
  let masterB: string;
  let cliente: string;

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    masterA = await tokenOficina(app, c.a.master.email);
    masterB = await tokenOficina(app, c.b.master.email);
    cliente = await tokenCliente(app, c.cliente.email);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('lado do cliente', () => {
    let veiculoId: string;

    it('cadastra veículo com placa normalizada e não duplica a placa', async () => {
      const res = await http()
        .post('/cliente/veiculos')
        .auth(cliente, { type: 'bearer' })
        .send({ placa: 'abc-1d23', marca: 'VW', modelo: 'Gol', ano: 2018 })
        .expect(201);
      expect(res.body).toMatchObject({ placa: 'ABC1D23', clienteId: c.cliente.id });
      veiculoId = res.body.id as string;

      await http()
        .post('/cliente/veiculos')
        .auth(cliente, { type: 'bearer' })
        .send({ placa: 'ABC1D23' })
        .expect(409);
      await http()
        .post('/cliente/veiculos')
        .auth(cliente, { type: 'bearer' })
        .send({ placa: 'AB12345' })
        .expect(400);
    });

    it('veículo cadastrado pelo cliente não aparece para a oficina até ter vínculo', async () => {
      const lista = await http()
        .get('/oficina/veiculos')
        .auth(masterA, { type: 'bearer' })
        .expect(200);
      expect((lista.body as { id: string }[]).map((v) => v.id)).not.toContain(veiculoId);
      await http()
        .get(`/oficina/veiculos/${veiculoId}`)
        .auth(masterA, { type: 'bearer' })
        .expect(404);
    });

    it('atualiza e remove (lógico) o próprio veículo', async () => {
      await http()
        .patch(`/cliente/veiculos/${veiculoId}`)
        .auth(cliente, { type: 'bearer' })
        .send({ cor: 'Prata' })
        .expect(200);
      await http()
        .delete(`/cliente/veiculos/${veiculoId}`)
        .auth(cliente, { type: 'bearer' })
        .expect(204);
      const lista = await http()
        .get('/cliente/veiculos')
        .auth(cliente, { type: 'bearer' })
        .expect(200);
      expect((lista.body as { id: string }[]).map((v) => v.id)).not.toContain(veiculoId);
      expect(await prisma.veiculo.findUnique({ where: { id: veiculoId } })).toMatchObject({
        ativo: false,
      });

      // Recadastrar a mesma placa reaproveita o registro.
      const again = await http()
        .post('/cliente/veiculos')
        .auth(cliente, { type: 'bearer' })
        .send({ placa: 'ABC1D23' })
        .expect(201);
      expect(again.body.id).toBe(veiculoId);
    });

    it('perfil: lê e atualiza telefone/endereço, sem expor senha', async () => {
      const res = await http()
        .patch('/cliente/perfil')
        .auth(cliente, { type: 'bearer' })
        .send({ telefone: '(11) 97777-1234', cidade: 'Santos', uf: 'SP' })
        .expect(200);
      expect(res.body).toMatchObject({ telefone: '11977771234', cidade: 'Santos' });
      expect(JSON.stringify(res.body)).not.toContain('senhaHash');
      await http()
        .patch('/cliente/perfil')
        .auth(cliente, { type: 'bearer' })
        .send({ cpf: '123' })
        .expect(400);
    });
  });

  describe('lado da oficina', () => {
    let veiculoId: string;

    it('oficina cadastra veículo de cliente dela e o vínculo é criado', async () => {
      const res = await http()
        .post('/oficina/veiculos')
        .auth(masterA, { type: 'bearer' })
        .send({ clienteId: c.cliente.id, placa: 'XYZ9876', modelo: 'Onix' })
        .expect(201);
      veiculoId = res.body.id as string;
      expect(res.body).toMatchObject({ placa: 'XYZ9876', cliente: { id: c.cliente.id } });

      const det = await http()
        .get(`/oficina/clientes/${c.cliente.id}`)
        .auth(masterA, { type: 'bearer' })
        .expect(200);
      expect((det.body.veiculos as { id: string }[]).map((v) => v.id)).toEqual([veiculoId]);

      // O cliente vê o veículo cadastrado pela oficina.
      const meus = await http()
        .get('/cliente/veiculos')
        .auth(cliente, { type: 'bearer' })
        .expect(200);
      expect((meus.body as { id: string }[]).map((v) => v.id)).toContain(veiculoId);
    });

    it('placa já existente do cliente é reaproveitada (sem duplicar)', async () => {
      const res = await http()
        .post('/oficina/veiculos')
        .auth(masterA, { type: 'bearer' })
        .send({ clienteId: c.cliente.id, placa: 'ABC-1D23' })
        .expect(201);
      const total = await prisma.veiculo.count({
        where: { clienteId: c.cliente.id, placa: 'ABC1D23' },
      });
      expect(total).toBe(1);
      expect(res.body.placa).toBe('ABC1D23');
    });

    it('oficina B não vê cliente nem veículos da A, e não cadastra veículo para cliente que não é dela', async () => {
      await http()
        .get(`/oficina/veiculos/${veiculoId}`)
        .auth(masterB, { type: 'bearer' })
        .expect(404);
      await http()
        .patch(`/oficina/veiculos/${veiculoId}`)
        .auth(masterB, { type: 'bearer' })
        .send({ cor: 'Hackeado' })
        .expect(404);
      await http()
        .post('/oficina/veiculos')
        .auth(masterB, { type: 'bearer' })
        .send({ clienteId: c.cliente.id, placa: 'QWE1234' })
        .expect(404);
      const lista = await http()
        .get('/oficina/veiculos')
        .auth(masterB, { type: 'bearer' })
        .expect(200);
      expect(lista.body).toEqual([]);
      expect(await prisma.veiculo.findUnique({ where: { id: veiculoId } })).toMatchObject({
        cor: null,
      });
    });

    it('observações internas: a oficina grava e o cliente não vê', async () => {
      await http()
        .patch(`/oficina/clientes/${c.cliente.id}/observacoes`)
        .auth(masterA, { type: 'bearer' })
        .send({ observacoesInternas: 'Prefere contato por WhatsApp' })
        .expect(200);
      const perfil = await http()
        .get('/cliente/perfil')
        .auth(cliente, { type: 'bearer' })
        .expect(200);
      expect(JSON.stringify(perfil.body)).not.toContain('WhatsApp');
      const oficinas = await http()
        .get('/cliente/oficinas')
        .auth(cliente, { type: 'bearer' })
        .expect(200);
      expect(JSON.stringify(oficinas.body)).not.toContain('WhatsApp');

      await http()
        .patch(`/oficina/clientes/${c.cliente.id}/observacoes`)
        .auth(masterB, { type: 'bearer' })
        .send({ observacoesInternas: 'x' })
        .expect(404);
    });

    it('busca de clientes por nome e CPF', async () => {
      const porCpf = await http()
        .get(`/oficina/clientes?q=${c.cliente.cpf.slice(0, 6)}`)
        .auth(masterA, { type: 'bearer' })
        .expect(200);
      expect((porCpf.body as { id: string }[]).map((x) => x.id)).toContain(c.cliente.id);
      const nada = await http()
        .get('/oficina/clientes?q=zzzzzz')
        .auth(masterA, { type: 'bearer' })
        .expect(200);
      expect(nada.body).toEqual([]);
    });
  });
});
