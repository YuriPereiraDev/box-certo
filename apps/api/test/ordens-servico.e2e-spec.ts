import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
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

/** PNG 1x1 válido. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Item {
  id: string;
  descricao: string;
  statusCliente: string;
  totalCentavos: number;
  custoUnitarioCentavos?: number;
  descontoStatus?: string | null;
}
interface Os {
  id: string;
  numero: number;
  status: string;
  itens: Item[];
  totais: {
    orcado: { totalCentavos: number };
    aprovado: { totalCentavos: number; brutoCentavos: number };
  };
}

const binario = (r: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const partes: Buffer[] = [];
  r.on('data', (p: Buffer) => partes.push(p));
  r.on('end', () => cb(null, Buffer.concat(partes)));
};

describe('Ordens de serviço e orçamento (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let c: Cenario;
  let master: string;
  let mecanico: string;
  let gerente: string;
  let outroMecanico: string;
  let financeiro: string;
  let masterB: string;
  let cliente: string;
  let veiculoId: string;
  let itemTabelaId: string;

  beforeAll(async () => {
    app = await criarApp();
    prisma = criarPrisma();
    c = await criarCenario(prisma, app);
    for (let diaSemana = 0; diaSemana <= 6; diaSemana++) {
      await prisma.horarioFuncionamento.create({
        data: { oficinaId: c.a.id, diaSemana, abre: '08:00', fecha: '18:00' },
      });
    }
    const fin = await prisma.user.create({
      data: {
        oficinaId: c.a.id,
        nome: 'Financeiro',
        email: `fin-${randomUUID().slice(0, 8)}@teste.local`,
        senhaHash: await argon2.hash(SENHA),
        role: 'FINANCEIRO',
        permissoes: ['FINANCEIRO'],
      },
    });
    veiculoId = (
      await prisma.veiculo.create({ data: { clienteId: c.cliente.id, placa: 'OSA1B23' } })
    ).id;
    itemTabelaId = (
      await prisma.itemTabelaPreco.create({
        data: {
          oficinaId: c.a.id,
          nome: 'Troca de óleo',
          tipo: 'MAO_DE_OBRA',
          precoCentavos: 8_000,
        },
      })
    ).id;
    await prisma.oficina.update({
      where: { id: c.a.id },
      data: { mecanicoPodeDarDesconto: true, limiteDescontoPercentual: 10 },
    });

    master = await tokenOficina(app, c.a.master.email);
    mecanico = await tokenOficina(app, c.a.mecanico.email);
    gerente = await tokenOficina(app, c.a.mecanicoGerente.email);
    outroMecanico = await tokenOficina(app, c.a.mecanicoLogs.email);
    financeiro = await tokenOficina(app, fin.email);
    masterB = await tokenOficina(app, c.b.master.email);
    cliente = await tokenCliente(app, c.cliente.email);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const novaOs = async (token = mecanico): Promise<Os> =>
    (
      await http()
        .post('/oficina/ordens-servico')
        .auth(token, { type: 'bearer' })
        .send({ clienteId: c.cliente.id, veiculoId })
        .expect(201)
    ).body as Os;
  const addItem = async (osId: string, corpo: Record<string, unknown>, token = mecanico) =>
    (
      await http()
        .post(`/oficina/ordens-servico/${osId}/itens`)
        .auth(token, { type: 'bearer' })
        .send(corpo)
        .expect(201)
    ).body as Os;
  const enviar = (osId: string, token = mecanico) =>
    http().post(`/oficina/ordens-servico/${osId}/enviar`).auth(token, { type: 'bearer' });
  const responder = (osId: string, respostas: unknown[]) =>
    http()
      .post(`/cliente/ordens-servico/${osId}/respostas`)
      .auth(cliente, { type: 'bearer' })
      .send({ respostas });

  it('critério da fase: agendamento → OS → aprovação → conclusão', async () => {
    // 1. Cliente agenda.
    const dia = somarDias(dataLocal(new Date()), 2);
    const ag = await http()
      .post('/cliente/agendamentos')
      .auth(cliente, { type: 'bearer' })
      .send({
        oficinaId: c.a.id,
        veiculoId,
        inicio: localParaUtc(dia, 9 * 60).toISOString(),
        tipoServico: 'Barulho no freio',
      })
      .expect(201);

    // 2. Oficina atribui o mecânico e ele abre a OS a partir do agendamento.
    await http()
      .patch(`/oficina/agendamentos/${ag.body.id as string}/mecanico`)
      .auth(master, { type: 'bearer' })
      .send({ mecanicoId: c.a.mecanico.id })
      .expect(200);
    const aberta = await http()
      .post('/oficina/ordens-servico')
      .auth(mecanico, { type: 'bearer' })
      .send({ agendamentoId: ag.body.id, kmEntrada: 45_000, combustivel: '1/2' })
      .expect(201);
    const os = aberta.body as Os & { mecanico: { id: string } };
    expect(os).toMatchObject({ status: 'ABERTA', mecanico: { id: c.a.mecanico.id } });
    expect(os.numero).toBeGreaterThan(0);
    expect(
      (await prisma.agendamento.findUniqueOrThrow({ where: { id: ag.body.id as string } })).status,
    ).toBe('EM_ATENDIMENTO');
    await http()
      .post('/oficina/ordens-servico')
      .auth(mecanico, { type: 'bearer' })
      .send({ agendamentoId: ag.body.id })
      .expect(409);

    // 3. Diagnóstico + itens (da tabela e manuais, com origem e link de afiliado).
    await http()
      .patch(`/oficina/ordens-servico/${os.id}`)
      .auth(mecanico, { type: 'bearer' })
      .send({ diagnostico: 'Pastilhas gastas' })
      .expect(200);
    await addItem(os.id, { tabelaPrecoId: itemTabelaId });
    await addItem(os.id, {
      descricao: 'Pastilha de freio',
      tipo: 'PECA',
      origemPeca: 'COMPRADA_SEPARADO',
      quantidade: 2,
      precoUnitarioCentavos: 9_000,
      linkAfiliado: 'https://loja.exemplo/pastilha',
    });
    const comItens = await addItem(os.id, {
      descricao: 'Fluido de freio',
      tipo: 'PECA',
      origemPeca: 'CLIENTE_COMPRA',
      precoUnitarioCentavos: 5_000,
      linkAfiliado: 'https://loja.exemplo/fluido',
    });
    expect(comItens.status).toBe('EM_DIAGNOSTICO');
    expect(comItens.itens).toHaveLength(3);
    expect(comItens.itens[2].totalCentavos).toBe(0); // cliente compra por conta própria
    expect(comItens.totais.orcado.totalCentavos).toBe(8_000 + 18_000);

    // 4. Antes do envio o cliente não vê os itens.
    const rascunho = await http()
      .get(`/cliente/ordens-servico/${os.id}`)
      .auth(cliente, { type: 'bearer' })
      .expect(200);
    expect(rascunho.body).toMatchObject({ orcamentoDisponivel: false, itens: [] });

    // 5. Envio e aprovação item por item.
    await enviar(os.id).expect(200);
    const visto = await http()
      .get(`/cliente/ordens-servico/${os.id}`)
      .auth(cliente, { type: 'bearer' })
      .expect(200);
    expect(visto.body.orcamentoDisponivel).toBe(true);
    const [oleo, pastilha, fluido] = visto.body.itens as (Item & { comprarPeca: boolean })[];
    expect(pastilha.comprarPeca).toBe(true);
    expect(JSON.stringify(visto.body)).not.toContain('custoUnitario');

    await responder(os.id, [{ itemId: oleo.id, aprovado: true }]).expect(200);
    await responder(os.id, [{ itemId: oleo.id, aprovado: false }]).expect(422); // já respondido
    const aprov = await responder(os.id, [
      { itemId: pastilha.id, aprovado: true },
      { itemId: fluido.id, aprovado: false },
    ]).expect(200);
    expect(aprov.body.status).toBe('APROVADA');
    expect(aprov.body.totais.aprovado.totalCentavos).toBe(26_000);

    // 6. Execução e conclusão (com pagamento na oficina).
    await http()
      .post(`/oficina/ordens-servico/${os.id}/concluir`)
      .auth(mecanico, { type: 'bearer' })
      .send({})
      .expect(422);
    await http()
      .post(`/oficina/ordens-servico/${os.id}/iniciar`)
      .auth(mecanico, { type: 'bearer' })
      .expect(200);
    const fim = await http()
      .post(`/oficina/ordens-servico/${os.id}/concluir`)
      .auth(mecanico, { type: 'bearer' })
      .send({ formaPagamento: 'PIX' })
      .expect(200);
    expect(fim.body).toMatchObject({
      status: 'CONCLUIDA',
      statusPagamento: 'PAGO_NA_OFICINA',
      formaPagamento: 'PIX',
    });
    expect(
      (await prisma.agendamento.findUniqueOrThrow({ where: { id: ag.body.id as string } })).status,
    ).toBe('CONCLUIDO');

    // 7. Histórico do veículo (oficina e cliente) e auditoria.
    const hist = await http()
      .get(`/oficina/veiculos/${veiculoId}/historico`)
      .auth(master, { type: 'bearer' })
      .expect(200);
    const naOficina = (
      hist.body.ordensServico as { id: string; servicos: string[]; totalCentavos: number }[]
    ).find((o) => o.id === os.id);
    expect(naOficina).toMatchObject({
      totalCentavos: 26_000,
      servicos: ['Troca de óleo', 'Pastilha de freio'],
    });
    const histCli = await http()
      .get(`/cliente/veiculos/${veiculoId}/historico`)
      .auth(cliente, { type: 'bearer' })
      .expect(200);
    expect((histCli.body.ordensServico as { id: string }[]).map((o) => o.id)).toContain(os.id);

    const acoes = (
      await prisma.auditLog.findMany({
        where: { entidadeId: os.id, entidade: 'OrdemServico' },
        select: { acao: true },
      })
    ).map((l) => l.acao);
    expect(acoes).toEqual(
      expect.arrayContaining(['OS_ABERTA', 'OS_ORCAMENTO_ENVIADO', 'OS_CONCLUIDA']),
    );
  });

  it('número da OS é sequencial por oficina', async () => {
    const a1 = await novaOs();
    const a2 = await novaOs();
    expect(a2.numero).toBe(a1.numero + 1);
  });

  describe('custo, permissões e isolamento', () => {
    let osId: string;

    beforeAll(async () => {
      osId = (await novaOs()).id;
    });

    it('custo das peças: mecânico não informa nem vê; master e financeiro veem', async () => {
      await http()
        .post(`/oficina/ordens-servico/${osId}/itens`)
        .auth(mecanico, { type: 'bearer' })
        .send({
          descricao: 'Filtro',
          tipo: 'PECA',
          origemPeca: 'COMPRADA_SEPARADO',
          precoUnitarioCentavos: 3_000,
          custoUnitarioCentavos: 1_500,
        })
        .expect(403);
      await addItem(
        osId,
        {
          descricao: 'Filtro',
          tipo: 'PECA',
          origemPeca: 'COMPRADA_SEPARADO',
          precoUnitarioCentavos: 3_000,
          custoUnitarioCentavos: 1_500,
        },
        master,
      );

      const doMecanico = await http()
        .get(`/oficina/ordens-servico/${osId}`)
        .auth(mecanico, { type: 'bearer' })
        .expect(200);
      expect(JSON.stringify(doMecanico.body)).not.toContain('custoUnitario');
      const doFinanceiro = await http()
        .get(`/oficina/ordens-servico/${osId}`)
        .auth(financeiro, { type: 'bearer' })
        .expect(200);
      expect((doFinanceiro.body as Os).itens[0].custoUnitarioCentavos).toBe(1_500);
    });

    it('peça de ESTOQUE exige a peça do estoque', async () => {
      const r = await http()
        .post(`/oficina/ordens-servico/${osId}/itens`)
        .auth(mecanico, { type: 'bearer' })
        .send({ descricao: 'X', tipo: 'PECA', origemPeca: 'ESTOQUE', precoUnitarioCentavos: 100 })
        .expect(400);
      expect(r.body.mensagem).toMatch(/estoqueItemId/);
    });

    it('mecânico vê só as próprias OS; outro mecânico não acessa nem altera', async () => {
      await http()
        .get(`/oficina/ordens-servico/${osId}`)
        .auth(outroMecanico, { type: 'bearer' })
        .expect(404);
      const lista = await http()
        .get('/oficina/ordens-servico')
        .auth(outroMecanico, { type: 'bearer' })
        .expect(200);
      expect((lista.body as { id: string }[]).map((o) => o.id)).not.toContain(osId);
      await http()
        .get(`/oficina/ordens-servico/${osId}`)
        .auth(gerente, { type: 'bearer' })
        .expect(200);
    });

    it('histórico do veículo: qualquer mecânico vê todas as OS do veículo, sem custo', async () => {
      const hist = await http()
        .get(`/oficina/veiculos/${veiculoId}/historico`)
        .auth(outroMecanico, { type: 'bearer' })
        .expect(200);
      const ordens = hist.body.ordensServico as { id: string; mecanico: { id: string } }[];
      expect(ordens.map((o) => o.id)).toContain(osId);
      expect(ordens.some((o) => o.mecanico.id !== c.a.mecanicoLogs.id)).toBe(true);
      expect(JSON.stringify(hist.body)).not.toContain('custoUnitario');
    });

    it('outra oficina não vê nem altera a OS (404)', async () => {
      await http()
        .get(`/oficina/ordens-servico/${osId}`)
        .auth(masterB, { type: 'bearer' })
        .expect(404);
      await http()
        .post(`/oficina/ordens-servico/${osId}/cancelar`)
        .auth(masterB, { type: 'bearer' })
        .send({ motivo: 'x' })
        .expect(404);
      await http()
        .get(`/oficina/ordens-servico/${osId}/pdf`)
        .auth(masterB, { type: 'bearer' })
        .expect(404);
    });
  });

  describe('descontos', () => {
    let os: Os;

    beforeAll(async () => {
      os = await novaOs();
      os = await addItem(os.id, {
        descricao: 'Mão de obra',
        tipo: 'MAO_DE_OBRA',
        precoUnitarioCentavos: 10_000,
      });
    });

    const descItem = (token: string, corpo: Record<string, unknown>) =>
      http()
        .put(`/oficina/ordens-servico/${os.id}/itens/${os.itens[0].id}/desconto`)
        .auth(token, { type: 'bearer' })
        .send(corpo);

    it('mecânico dentro do limite (10%): aplicado', async () => {
      const r = await descItem(mecanico, {
        tipo: 'PERCENTUAL',
        valor: 10,
        motivo: 'Cliente antigo',
      }).expect(200);
      expect(r.body.itens[0]).toMatchObject({ descontoStatus: 'APLICADO', totalCentavos: 9_000 });
    });

    it('acima do limite: pendente, não reduz o total até o gerente aprovar', async () => {
      const r = await descItem(mecanico, { tipo: 'VALOR', valor: 3_000 }).expect(200);
      expect(r.body.itens[0]).toMatchObject({
        descontoStatus: 'PENDENTE_APROVACAO',
        totalCentavos: 10_000,
      });
      await http()
        .post(`/oficina/ordens-servico/${os.id}/itens/${os.itens[0].id}/desconto/decisao`)
        .auth(mecanico, { type: 'bearer' })
        .send({ aprovar: true })
        .expect(403);
      const ok = await http()
        .post(`/oficina/ordens-servico/${os.id}/itens/${os.itens[0].id}/desconto/decisao`)
        .auth(gerente, { type: 'bearer' })
        .send({ aprovar: true })
        .expect(200);
      expect(ok.body.itens[0]).toMatchObject({ descontoStatus: 'APLICADO', totalCentavos: 7_000 });
    });

    it('oficina sem permissão para mecânico: vira pedido de aprovação', async () => {
      await prisma.oficina.update({
        where: { id: c.a.id },
        data: { mecanicoPodeDarDesconto: false },
      });
      try {
        const r = await http()
          .put(`/oficina/ordens-servico/${os.id}/desconto`)
          .auth(mecanico, { type: 'bearer' })
          .send({ tipo: 'VALOR', valor: 100 })
          .expect(200);
        expect(r.body.descontoStatus).toBe('PENDENTE_APROVACAO');
      } finally {
        await prisma.oficina.update({
          where: { id: c.a.id },
          data: { mecanicoPodeDarDesconto: true },
        });
      }
    });

    it('gerente dá desconto em qualquer OS; outro mecânico não', async () => {
      await http()
        .put(`/oficina/ordens-servico/${os.id}/desconto`)
        .auth(outroMecanico, { type: 'bearer' })
        .send({ tipo: 'VALOR', valor: 100 })
        .expect(404); // nem enxerga a OS
      const r = await http()
        .put(`/oficina/ordens-servico/${os.id}/desconto`)
        .auth(gerente, { type: 'bearer' })
        .send({ tipo: 'PERCENTUAL', valor: 50, motivo: 'Garantia' })
        .expect(200);
      expect(r.body).toMatchObject({ descontoStatus: 'APLICADO' });
      expect(r.body.totais.orcado.totalCentavos).toBe(3_500);
      const log = await prisma.auditLog.findFirst({
        where: {
          acao: 'OS_DESCONTO_SOLICITADO',
          entidadeId: os.id,
          atorId: c.a.mecanicoGerente.id,
        },
      });
      expect(log?.motivo).toBe('Garantia');
    });

    it('cliente vê valor original, desconto e total', async () => {
      await enviar(os.id).expect(200);
      const r = await http()
        .get(`/cliente/ordens-servico/${os.id}`)
        .auth(cliente, { type: 'bearer' })
        .expect(200);
      expect(r.body.itens[0]).toMatchObject({
        brutoCentavos: 10_000,
        descontoCentavos: 3_000,
        totalCentavos: 7_000,
      });
      expect(r.body.descontoOs).toEqual({ tipo: 'PERCENTUAL', valor: 50 });
    });
  });

  describe('alterações, recusa total, peça do cliente e cancelamento', () => {
    it('editar depois do envio zera as respostas e exige reenvio', async () => {
      let os = await novaOs();
      os = await addItem(os.id, {
        descricao: 'A',
        tipo: 'MAO_DE_OBRA',
        precoUnitarioCentavos: 1_000,
      });
      os = await addItem(os.id, {
        descricao: 'B',
        tipo: 'MAO_DE_OBRA',
        precoUnitarioCentavos: 2_000,
      });
      await enviar(os.id).expect(200);
      await responder(os.id, [{ itemId: os.itens[0].id, aprovado: true }]).expect(200);

      const editada = await http()
        .patch(`/oficina/ordens-servico/${os.id}/itens/${os.itens[1].id}`)
        .auth(mecanico, { type: 'bearer' })
        .send({ precoUnitarioCentavos: 1_500 })
        .expect(200);
      expect(editada.body.status).toBe('EM_DIAGNOSTICO');
      expect((editada.body.itens as Item[]).every((i) => i.statusCliente === 'PENDENTE')).toBe(
        true,
      );
      await responder(os.id, [{ itemId: os.itens[1].id, aprovado: true }]).expect(422);
      await enviar(os.id).expect(200);
    });

    it('tudo recusado: volta para diagnóstico; cliente pode trazer a peça', async () => {
      let os = await novaOs();
      os = await addItem(os.id, {
        descricao: 'Amortecedor',
        tipo: 'PECA',
        origemPeca: 'COMPRADA_SEPARADO',
        precoUnitarioCentavos: 40_000,
      });
      os = await addItem(os.id, {
        descricao: 'Instalação',
        tipo: 'MAO_DE_OBRA',
        precoUnitarioCentavos: 15_000,
      });
      await enviar(os.id).expect(200);

      const recusada = await responder(os.id, [
        { itemId: os.itens[0].id, aprovado: false },
        { itemId: os.itens[1].id, aprovado: false },
      ]).expect(200);
      expect(recusada.body.status).toBe('EM_DIAGNOSTICO');

      // Oficina reenvia; cliente recusa a peça avisando que vai trazê-la e aprova a mão de obra.
      await enviar(os.id).expect(200);
      const r = await responder(os.id, [
        { itemId: os.itens[0].id, aprovado: false, vouTrazerAPeca: true },
        { itemId: os.itens[1].id, aprovado: true },
      ]).expect(200);
      expect(r.body.status).toBe('APROVADA');
      const trazida = (r.body.itens as (Item & { substituiItemId: string | null })[]).find(
        (i) => i.substituiItemId === os.itens[0].id,
      );
      expect(trazida).toMatchObject({ statusCliente: 'APROVADO', totalCentavos: 0 });
      expect(trazida?.descricao).toMatch(/^Peça trazida pelo cliente/);
      expect(r.body.totais.aprovado.totalCentavos).toBe(15_000);

      await responder(os.id, [
        { itemId: os.itens[1].id, aprovado: true, vouTrazerAPeca: true },
      ]).expect(422);
    });

    it('oficina também troca peça recusada por "peça do cliente"', async () => {
      let os = await novaOs();
      os = await addItem(os.id, {
        descricao: 'Bateria',
        tipo: 'PECA',
        origemPeca: 'COMPRADA_SEPARADO',
        precoUnitarioCentavos: 50_000,
      });
      await enviar(os.id).expect(200);
      await responder(os.id, [{ itemId: os.itens[0].id, aprovado: false }]).expect(200);
      const r = await http()
        .post(`/oficina/ordens-servico/${os.id}/itens/${os.itens[0].id}/peca-do-cliente`)
        .auth(mecanico, { type: 'bearer' })
        .expect(201);
      expect((r.body.itens as Item[]).map((i) => i.descricao)).toContain(
        'Peça trazida pelo cliente: Bateria',
      );
    });

    it('cliente cancela antes da execução; depois de iniciada, não', async () => {
      const os1 = await novaOs();
      const r = await http()
        .post(`/cliente/ordens-servico/${os1.id}/cancelar`)
        .auth(cliente, { type: 'bearer' })
        .send({ motivo: 'Vendi o carro' })
        .expect(200);
      expect(r.body).toMatchObject({ status: 'CANCELADA', motivoCancelamento: 'Vendi o carro' });

      let os2 = await novaOs();
      os2 = await addItem(os2.id, {
        descricao: 'X',
        tipo: 'MAO_DE_OBRA',
        precoUnitarioCentavos: 1_000,
      });
      await enviar(os2.id).expect(200);
      await responder(os2.id, [{ itemId: os2.itens[0].id, aprovado: true }]).expect(200);
      await http()
        .post(`/oficina/ordens-servico/${os2.id}/iniciar`)
        .auth(mecanico, { type: 'bearer' })
        .expect(200);
      const bloq = await http()
        .post(`/cliente/ordens-servico/${os2.id}/cancelar`)
        .auth(cliente, { type: 'bearer' })
        .send({})
        .expect(422);
      expect(bloq.body.mensagem).toMatch(/Fale com a oficina/);
    });

    it('mecânico cancela a própria OS com motivo obrigatório', async () => {
      const os = await novaOs();
      await http()
        .post(`/oficina/ordens-servico/${os.id}/cancelar`)
        .auth(mecanico, { type: 'bearer' })
        .send({})
        .expect(400);
      await http()
        .post(`/oficina/ordens-servico/${os.id}/cancelar`)
        .auth(mecanico, { type: 'bearer' })
        .send({ motivo: 'Cliente desistiu' })
        .expect(200);
      await http()
        .post(`/oficina/ordens-servico/${os.id}/itens`)
        .auth(mecanico, { type: 'bearer' })
        .send({ descricao: 'X', tipo: 'MAO_DE_OBRA', precoUnitarioCentavos: 1 })
        .expect(422);
    });
  });

  describe('fotos e PDF', () => {
    let osId: string;

    beforeAll(async () => {
      const os = await novaOs();
      osId = (
        await addItem(os.id, {
          descricao: 'Revisão',
          tipo: 'MAO_DE_OBRA',
          precoUnitarioCentavos: 20_000,
        })
      ).id;
    });

    it('anexa foto no storage S3 e devolve URL assinada', async () => {
      const r = await http()
        .post(`/oficina/ordens-servico/${osId}/fotos`)
        .auth(mecanico, { type: 'bearer' })
        .attach('arquivo', PNG, { filename: 'freio.png', contentType: 'image/png' })
        .expect(201);
      expect(r.body).toMatchObject({ mime: 'image/png', nomeOriginal: 'freio.png' });
      const baixada = await fetch(r.body.url as string);
      expect(baixada.status).toBe(200);
      expect(Buffer.from(await baixada.arrayBuffer()).equals(PNG)).toBe(true);
    });

    it('recusa arquivo que não é imagem, mesmo com extensão .png', async () => {
      const r = await http()
        .post(`/oficina/ordens-servico/${osId}/fotos`)
        .auth(mecanico, { type: 'bearer' })
        .attach('arquivo', Buffer.from('não sou uma imagem, sou texto'), {
          filename: 'falso.png',
          contentType: 'image/png',
        })
        .expect(400);
      expect(r.body.mensagem).toMatch(/Formato não aceito/);
    });

    it('cliente vê as fotos depois do envio', async () => {
      await enviar(osId).expect(200);
      const r = await http()
        .get(`/cliente/ordens-servico/${osId}`)
        .auth(cliente, { type: 'bearer' })
        .expect(200);
      expect(r.body.fotos).toHaveLength(1);
    });

    it('gera PDF do orçamento para oficina e cliente', async () => {
      const r = await http()
        .get(`/oficina/ordens-servico/${osId}/pdf`)
        .auth(master, { type: 'bearer' })
        .buffer(true)
        .parse(binario)
        .expect(200);
      expect(r.headers['content-type']).toBe('application/pdf');
      expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

      const doCliente = await http()
        .get(`/cliente/ordens-servico/${osId}/pdf`)
        .auth(cliente, { type: 'bearer' })
        .buffer(true)
        .parse(binario)
        .expect(200);
      expect((doCliente.body as Buffer).length).toBeGreaterThan(1000);
    });

    it('logo da oficina entra no PDF', async () => {
      await http()
        .put('/oficina/logo')
        .auth(master, { type: 'bearer' })
        .attach('arquivo', PNG, { filename: 'logo.png', contentType: 'image/png' })
        .expect(200);
      const dados = await http().get('/oficina').auth(master, { type: 'bearer' }).expect(200);
      expect(dados.body.logoUrl).toMatch(/^http/);
      await http()
        .get(`/oficina/ordens-servico/${osId}/pdf`)
        .auth(master, { type: 'bearer' })
        .buffer(true)
        .parse(binario)
        .expect(200);
    });
  });
});
