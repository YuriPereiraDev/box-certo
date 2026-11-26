import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
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

interface Peca {
  id: string;
  quantidade: number;
  quantidadeReservada: number;
  disponivel: number;
  abaixoDoMinimo: boolean;
  custoCentavos?: number;
}
interface ItemOs {
  id: string;
  statusCliente: string;
  origemPeca: string | null;
  precoUnitarioCentavos: number;
  estoqueReservado: number;
}
interface Os {
  id: string;
  status: string;
  itens: ItemOs[];
}

describe('Estoque (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  let master: string;
  let mecanico: string;
  let estoquista: string;
  let masterB: string;
  let cliente: string;
  let veiculoId: string;

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    const email = `estoquista-${randomUUID().slice(0, 8)}@teste.local`;
    await prisma.user.create({
      data: {
        oficinaId: c.a.id,
        nome: 'Estoquista',
        email,
        senhaHash: await argon2.hash(SENHA),
        role: 'FINANCEIRO',
        permissoes: ['GERIR_ESTOQUE'],
      },
    });
    veiculoId = (
      await prisma.veiculo.create({ data: { clienteId: c.cliente.id, placa: 'EST0Q12' } })
    ).id;
    master = await tokenOficina(app, c.a.master.email);
    mecanico = await tokenOficina(app, c.a.mecanico.email);
    estoquista = await tokenOficina(app, email);
    masterB = await tokenOficina(app, c.b.master.email);
    cliente = await tokenCliente(app, c.cliente.email);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const novaPeca = async (corpo: Record<string, unknown> = {}) =>
    (
      await http()
        .post('/oficina/estoque')
        .auth(estoquista, { type: 'bearer' })
        .send({ nome: `Peça ${randomUUID().slice(0, 6)}`, precoVendaCentavos: 5_000, ...corpo })
        .expect(201)
    ).body as Peca;
  const entrada = (id: string, corpo: Record<string, unknown>, token = estoquista) =>
    http().post(`/oficina/estoque/${id}/entradas`).auth(token, { type: 'bearer' }).send(corpo);
  const peca = async (id: string) =>
    (await http().get(`/oficina/estoque/${id}`).auth(master, { type: 'bearer' }).expect(200))
      .body as Peca;
  const novaOsComPeca = async (estoqueItemId: string, quantidade: number) => {
    const os = (
      await http()
        .post('/oficina/ordens-servico')
        .auth(mecanico, { type: 'bearer' })
        .send({ clienteId: c.cliente.id, veiculoId })
        .expect(201)
    ).body as Os;
    return (
      await http()
        .post(`/oficina/ordens-servico/${os.id}/itens`)
        .auth(mecanico, { type: 'bearer' })
        .send({ estoqueItemId, quantidade })
        .expect(201)
    ).body as Os;
  };
  const enviar = (osId: string) =>
    http()
      .post(`/oficina/ordens-servico/${osId}/enviar`)
      .auth(mecanico, { type: 'bearer' })
      .expect(200);
  const aprovar = (os: Os, aprovado = true) =>
    http()
      .post(`/cliente/ordens-servico/${os.id}/respostas`)
      .auth(cliente, { type: 'bearer' })
      .send({ respostas: [{ itemId: os.itens[0].id, aprovado }] });

  describe('cadastro, permissões e custo', () => {
    it('GERIR_ESTOQUE cadastra e informa custo, mas não vê o custo; master vê', async () => {
      const p = await novaPeca({ custoCentavos: 1_000, codigo: `C-${randomUUID().slice(0, 6)}` });
      expect(p).not.toHaveProperty('custoCentavos');
      expect((await peca(p.id)).custoCentavos).toBe(1_000);
    });

    it('mecânico comum consulta sem custo e não cadastra', async () => {
      const lista = await http()
        .get('/oficina/estoque')
        .auth(mecanico, { type: 'bearer' })
        .expect(200);
      expect(JSON.stringify(lista.body)).not.toContain('custoCentavos');
      await http()
        .post('/oficina/estoque')
        .auth(mecanico, { type: 'bearer' })
        .send({ nome: 'X', precoVendaCentavos: 1 })
        .expect(403);
    });

    it('outra oficina não vê nem usa a peça (404)', async () => {
      const p = await novaPeca();
      await http().get(`/oficina/estoque/${p.id}`).auth(masterB, { type: 'bearer' }).expect(404);
      await entrada(p.id, { quantidade: 1, custoUnitarioCentavos: 1 }, masterB).expect(404);
      const osB = (
        await http().post('/oficina/ordens-servico').auth(masterB, { type: 'bearer' }).send({
          clienteId: c.cliente.id,
          veiculoId,
        })
      ).status;
      expect(osB).toBe(404); // cliente não é da B; e a peça também não seria
    });
  });

  describe('entradas, custo médio, despesa automática e ajustes', () => {
    let p: Peca;

    beforeAll(async () => {
      p = await novaPeca({ estoqueMinimo: 5 });
    });

    it('entrada soma a quantidade e gera despesa "a pagar" na categoria Peças', async () => {
      const r = await entrada(p.id, {
        quantidade: 10,
        custoUnitarioCentavos: 1_000,
        fornecedor: 'Distribuidora X',
        notaFiscal: '123',
      }).expect(201);
      expect(r.body.peca).toMatchObject({ quantidade: 10, disponivel: 10 });
      expect(r.body.peca).not.toHaveProperty('custoCentavos');
      const despesa = await prisma.despesa.findUniqueOrThrow({
        where: { id: r.body.despesaId as string },
        include: { categoria: true },
      });
      expect(despesa).toMatchObject({
        valorCentavos: 10_000,
        status: 'A_PAGAR',
        oficinaId: c.a.id,
      });
      expect(despesa.categoria.nome).toBe('Peças');
      expect(despesa.descricao).toMatch(/Distribuidora X.*NF 123/);
    });

    it('custo médio ponderado: 10 a R$ 10 + 10 a R$ 14 = R$ 12', async () => {
      const r = await entrada(p.id, {
        quantidade: 10,
        custoUnitarioCentavos: 1_400,
        despesaPaga: true,
        formaPagamento: 'PIX',
      }).expect(201);
      expect((await peca(p.id)).custoCentavos).toBe(1_200);
      const despesa = await prisma.despesa.findUniqueOrThrow({
        where: { id: r.body.despesaId as string },
      });
      expect(despesa).toMatchObject({ status: 'PAGO', formaPagamento: 'PIX' });
      expect(despesa.pagoEm).toBeInstanceOf(Date);
    });

    it('sem despesa quando desmarcado', async () => {
      const r = await entrada(p.id, {
        quantidade: 1,
        custoUnitarioCentavos: 1_200,
        gerarDespesa: false,
      }).expect(201);
      expect(r.body.despesaId).toBeNull();
    });

    it('ajuste exige motivo e registra a diferença', async () => {
      await http()
        .post(`/oficina/estoque/${p.id}/ajustes`)
        .auth(estoquista, { type: 'bearer' })
        .send({ quantidade: 5 })
        .expect(400);
      const r = await http()
        .post(`/oficina/estoque/${p.id}/ajustes`)
        .auth(estoquista, { type: 'bearer' })
        .send({ quantidade: 5, motivo: 'Contagem de inventário' })
        .expect(201);
      expect(r.body).toMatchObject({ quantidade: 5, abaixoDoMinimo: true });
      const mov = await prisma.movimentoEstoque.findFirstOrThrow({
        where: { estoqueItemId: p.id, tipo: 'AJUSTE' },
      });
      expect(mov).toMatchObject({
        quantidade: -16,
        saldoQuantidade: 5,
        motivo: 'Contagem de inventário',
      });
      const log = await prisma.auditLog.findFirst({
        where: { acao: 'ESTOQUE_AJUSTE', motivo: 'Contagem de inventário' },
      });
      expect(log).not.toBeNull();
    });

    it('alerta de estoque mínimo', async () => {
      const alertas = await http()
        .get('/oficina/estoque/alertas')
        .auth(mecanico, { type: 'bearer' })
        .expect(200);
      expect((alertas.body as Peca[]).map((x) => x.id)).toContain(p.id);
    });

    it('movimentos: custo só para quem pode ver', async () => {
      const doMecanico = await http()
        .get(`/oficina/estoque/${p.id}/movimentos`)
        .auth(mecanico, { type: 'bearer' })
        .expect(200);
      expect(doMecanico.body.total).toBe(4);
      expect(JSON.stringify(doMecanico.body)).not.toContain('custoUnitarioCentavos');
      const doMaster = await http()
        .get(`/oficina/estoque/${p.id}/movimentos`)
        .auth(master, { type: 'bearer' })
        .expect(200);
      expect(JSON.stringify(doMaster.body)).toContain('custoUnitarioCentavos');
    });
  });

  describe('critério da fase: reserva e baixa corretas na OS', () => {
    it('aprovação reserva, conclusão dá saída (baixa quantidade e reserva)', async () => {
      const p = await novaPeca({ precoVendaCentavos: 7_500, custoCentavos: 4_000 });
      await entrada(p.id, { quantidade: 10, custoUnitarioCentavos: 4_000 }).expect(201);

      const os = await novaOsComPeca(p.id, 3);
      expect(os.itens[0]).toMatchObject({
        origemPeca: 'ESTOQUE',
        precoUnitarioCentavos: 7_500,
        estoqueReservado: 0,
      });
      expect((await peca(p.id)).quantidadeReservada).toBe(0); // adicionar não reserva

      await enviar(os.id);
      const r = await aprovar(os).expect(200);
      expect(r.body.status).toBe('APROVADA');
      expect(await peca(p.id)).toMatchObject({
        quantidade: 10,
        quantidadeReservada: 3,
        disponivel: 7,
      });

      await http()
        .post(`/oficina/ordens-servico/${os.id}/iniciar`)
        .auth(mecanico, { type: 'bearer' })
        .expect(200);
      await http()
        .post(`/oficina/ordens-servico/${os.id}/concluir`)
        .auth(mecanico, { type: 'bearer' })
        .send({})
        .expect(200);
      expect(await peca(p.id)).toMatchObject({
        quantidade: 7,
        quantidadeReservada: 0,
        disponivel: 7,
      });

      const tipos = (
        await prisma.movimentoEstoque.findMany({
          where: { ordemServicoId: os.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((m) => `${m.tipo}:${m.quantidade}`);
      expect(tipos).toEqual(['RESERVA:3', 'SAIDA:3']);
      const saida = await prisma.movimentoEstoque.findFirstOrThrow({
        where: { ordemServicoId: os.id, tipo: 'SAIDA' },
      });
      expect(saida.custoUnitarioCentavos).toBe(4_000);
    });

    it('recusa não reserva; alteração depois da aprovação libera a reserva', async () => {
      const p = await novaPeca();
      await entrada(p.id, { quantidade: 5, custoUnitarioCentavos: 100 }).expect(201);

      const recusada = await novaOsComPeca(p.id, 2);
      await enviar(recusada.id);
      await aprovar(recusada, false).expect(200);
      expect((await peca(p.id)).quantidadeReservada).toBe(0);

      const os = await novaOsComPeca(p.id, 2);
      await enviar(os.id);
      await aprovar(os).expect(200);
      expect((await peca(p.id)).quantidadeReservada).toBe(2);

      const editada = await http()
        .patch(`/oficina/ordens-servico/${os.id}/itens/${os.itens[0].id}`)
        .auth(mecanico, { type: 'bearer' })
        .send({ quantidade: 4 })
        .expect(200);
      expect(editada.body.status).toBe('EM_DIAGNOSTICO');
      expect((await peca(p.id)).quantidadeReservada).toBe(0);
      const lib = await prisma.movimentoEstoque.findFirst({
        where: { ordemServicoId: os.id, tipo: 'LIBERACAO_RESERVA' },
      });
      expect(lib).toMatchObject({ quantidade: 2, motivo: 'Orçamento alterado' });
    });

    it('cancelar a OS (oficina ou cliente) libera a reserva', async () => {
      const p = await novaPeca();
      await entrada(p.id, { quantidade: 5, custoUnitarioCentavos: 100 }).expect(201);

      const os1 = await novaOsComPeca(p.id, 2);
      await enviar(os1.id);
      await aprovar(os1).expect(200);
      await http()
        .post(`/cliente/ordens-servico/${os1.id}/cancelar`)
        .auth(cliente, { type: 'bearer' })
        .send({})
        .expect(200);
      expect((await peca(p.id)).quantidadeReservada).toBe(0);

      const os2 = await novaOsComPeca(p.id, 2);
      await enviar(os2.id);
      await aprovar(os2).expect(200);
      await http()
        .post(`/oficina/ordens-servico/${os2.id}/cancelar`)
        .auth(mecanico, { type: 'bearer' })
        .send({ motivo: 'Cliente desistiu' })
        .expect(200);
      expect((await peca(p.id)).quantidadeReservada).toBe(0);
    });

    it('não deixa colocar no orçamento mais do que o disponível', async () => {
      const p = await novaPeca();
      await entrada(p.id, { quantidade: 2, custoUnitarioCentavos: 100 }).expect(201);
      const os = (
        await http()
          .post('/oficina/ordens-servico')
          .auth(mecanico, { type: 'bearer' })
          .send({ clienteId: c.cliente.id, veiculoId })
          .expect(201)
      ).body as Os;
      const r = await http()
        .post(`/oficina/ordens-servico/${os.id}/itens`)
        .auth(mecanico, { type: 'bearer' })
        .send({ estoqueItemId: p.id, quantidade: 3 })
        .expect(422);
      expect(r.body).toMatchObject({ codigo: 'ESTOQUE_INSUFICIENTE', disponivel: 2 });
      expect(r.body.mensagem).toMatch(/troque a origem/);
    });

    it('sem saldo na aprovação: o item fica pendente e a oficina ajusta', async () => {
      const p = await novaPeca();
      await entrada(p.id, { quantidade: 2, custoUnitarioCentavos: 100 }).expect(201);
      const os1 = await novaOsComPeca(p.id, 2);
      const os2 = await novaOsComPeca(p.id, 2); // as duas cabiam quando foram montadas
      await enviar(os1.id);
      await enviar(os2.id);

      await aprovar(os1).expect(200);
      const r = await aprovar(os2).expect(200);
      expect(r.body.status).toBe('ORCAMENTO_ENVIADO');
      expect(r.body.itensIndisponiveis).toEqual([
        { itemId: os2.itens[0].id, descricao: expect.any(String) },
      ]);
      expect(r.body.itens[0]).toMatchObject({
        statusCliente: 'PENDENTE',
        aguardandoAjusteDaOficina: true,
      });
      expect(await peca(p.id)).toMatchObject({ quantidade: 2, quantidadeReservada: 2 });

      // A oficina troca a origem para "comprada separado" e reenvia; o cliente aprova.
      await http()
        .patch(`/oficina/ordens-servico/${os2.id}/itens/${os2.itens[0].id}`)
        .auth(mecanico, { type: 'bearer' })
        .send({ origemPeca: 'COMPRADA_SEPARADO' })
        .expect(200);
      await enviar(os2.id);
      const ok = await aprovar(os2).expect(200);
      expect(ok.body.status).toBe('APROVADA');
      expect((await peca(p.id)).quantidadeReservada).toBe(2); // só a da OS 1
    });

    it('aprovações simultâneas nunca reservam além do disponível', async () => {
      const p = await novaPeca();
      await entrada(p.id, { quantidade: 3, custoUnitarioCentavos: 100 }).expect(201);
      const ordens: Os[] = [];
      for (let i = 0; i < 3; i++) ordens.push(await novaOsComPeca(p.id, 2));
      for (const os of ordens) await enviar(os.id);

      const respostas = await Promise.all(ordens.map((os) => aprovar(os)));
      const aprovadas = respostas.filter((r) => r.body.status === 'APROVADA').length;
      expect(aprovadas).toBe(1);
      expect(await peca(p.id)).toMatchObject({
        quantidade: 3,
        quantidadeReservada: 2,
        disponivel: 1,
      });
    });

    it('não desativa peça com reserva nem ajusta abaixo do reservado', async () => {
      const p = await novaPeca();
      await entrada(p.id, { quantidade: 3, custoUnitarioCentavos: 100 }).expect(201);
      const os = await novaOsComPeca(p.id, 2);
      await enviar(os.id);
      await aprovar(os).expect(200);

      const d = await http()
        .delete(`/oficina/estoque/${p.id}`)
        .auth(estoquista, { type: 'bearer' })
        .expect(422);
      expect(d.body.codigo).toBe('PECA_RESERVADA');
      const a = await http()
        .post(`/oficina/estoque/${p.id}/ajustes`)
        .auth(estoquista, { type: 'bearer' })
        .send({ quantidade: 1, motivo: 'Perda' })
        .expect(422);
      expect(a.body.codigo).toBe('ABAIXO_DO_RESERVADO');
    });

    it('item da tabela de preços ligado ao estoque entra com origem ESTOQUE', async () => {
      const p = await novaPeca({ precoVendaCentavos: 3_300 });
      await entrada(p.id, { quantidade: 4, custoUnitarioCentavos: 100 }).expect(201);
      const t = await http()
        .post('/oficina/tabela-precos')
        .auth(master, { type: 'bearer' })
        .send({ nome: 'Filtro de ar', tipo: 'PECA', precoCentavos: 3_500, estoqueItemId: p.id })
        .expect(201);
      const os = (
        await http()
          .post('/oficina/ordens-servico')
          .auth(mecanico, { type: 'bearer' })
          .send({ clienteId: c.cliente.id, veiculoId })
          .expect(201)
      ).body as Os;
      const r = await http()
        .post(`/oficina/ordens-servico/${os.id}/itens`)
        .auth(mecanico, { type: 'bearer' })
        .send({ tabelaPrecoId: t.body.id })
        .expect(201);
      expect((r.body as Os).itens[0]).toMatchObject({
        origemPeca: 'ESTOQUE',
        precoUnitarioCentavos: 3_500,
      });

      await http()
        .post('/oficina/tabela-precos')
        .auth(masterB, { type: 'bearer' })
        .send({ nome: 'Roubo', tipo: 'PECA', precoCentavos: 1, estoqueItemId: p.id })
        .expect(404);
    });

    it('o banco recusa reserva maior que a quantidade (CHECK)', async () => {
      const p = await novaPeca();
      await expect(
        prisma.estoqueItem.update({ where: { id: p.id }, data: { quantidadeReservada: 1 } }),
      ).rejects.toThrow();
    });
  });
});
