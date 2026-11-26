/**
 * Seed do Box Certo.
 * - Super admin dono (dados do .env, isOwner = true, todas as permissões).
 * - Planos (Autônomo, Oficina, Rede).
 *
 * Idempotente: pode rodar várias vezes sem duplicar nada.
 * A oficina de exemplo (master, mecânicos, clientes, OS...) entra quando
 * esses modelos existirem (fases 2 a 6).
 */
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PermissaoPlataforma, PrismaClient } from '../src/generated/prisma/client.js';
import { gerarCpf } from '../src/common/utils/cpf.js';
import { dataLocal, localParaUtc, somarDias } from '../src/common/utils/datas.js';
import { CATEGORIAS_PADRAO } from '../src/despesas/categorias-padrao.js';

config({ path: ['.env', '../../.env'], quiet: true });

const PLANOS = [
  { nome: 'Autônomo', precoCentavos: 5900, maxMecanicos: 1 },
  { nome: 'Oficina', precoCentavos: 11900, maxMecanicos: 5 },
  { nome: 'Rede', precoCentavos: 19900, maxMecanicos: null },
];

function obrigatoria(nome: string): string {
  const valor = process.env[nome]?.trim();
  if (!valor) {
    throw new Error(`Variável ${nome} não definida no .env (necessária para o seed).`);
  }
  return valor;
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: obrigatoria('DATABASE_URL') }),
  });

  try {
    for (const plano of PLANOS) {
      await prisma.plano.upsert({
        where: { nome: plano.nome },
        update: { precoCentavos: plano.precoCentavos, maxMecanicos: plano.maxMecanicos },
        create: plano,
      });
    }
    console.log(`Planos: ${PLANOS.map((p) => p.nome).join(', ')}`);

    const email = obrigatoria('OWNER_EMAIL').toLowerCase();
    const senha = obrigatoria('OWNER_PASSWORD');
    if (senha.length < 12) {
      throw new Error('OWNER_PASSWORD precisa ter pelo menos 12 caracteres.');
    }
    const nome = process.env.OWNER_NAME?.trim() || 'Dono Box Certo';

    const existente = await prisma.platformAdmin.findUnique({ where: { email } });
    if (existente) {
      // Não sobrescreve a senha de um dono já criado; só garante as permissões.
      await prisma.platformAdmin.update({
        where: { email },
        data: { isOwner: true, ativo: true, permissoes: Object.values(PermissaoPlataforma) },
      });
      console.log(`Super admin dono já existia: ${email}`);
    } else {
      await prisma.platformAdmin.create({
        data: {
          nome,
          email,
          senhaHash: await argon2.hash(senha, { type: argon2.argon2id }),
          isOwner: true,
          permissoes: Object.values(PermissaoPlataforma),
        },
      });
      console.log(`Super admin dono criado: ${email}`);
    }

    await seedOficinaExemplo(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Oficina de exemplo para testar as telas. Todos os usuários e o cliente usam a senha
 * SEED_SENHA_USUARIOS do .env. Cresce a cada fase (tabela de preços, estoque, OS...).
 */
async function seedOficinaExemplo(prisma: PrismaClient) {
  const senha = process.env.SEED_SENHA_USUARIOS?.trim();
  if (!senha) {
    console.log('SEED_SENHA_USUARIOS vazio: oficina de exemplo não criada.');
    return;
  }
  const senhaHash = await argon2.hash(senha, { type: argon2.argon2id });
  const plano = await prisma.plano.findUniqueOrThrow({ where: { nome: 'Oficina' } });

  // SEED_OFICINA_NOME permite criar outra oficina de exemplo (o teste do dashboard usa isso).
  const nomeOficina = process.env.SEED_OFICINA_NOME?.trim() || 'Oficina Exemplo Box Certo';
  const oficina =
    (await prisma.oficina.findFirst({ where: { nome: nomeOficina } })) ??
    (await prisma.oficina.create({
      data: {
        nome: nomeOficina,
        email: 'contato@oficina-exemplo.local',
        telefone: '11999990000',
        cidade: 'São Paulo',
        uf: 'SP',
        status: 'TESTE',
        planoId: plano.id,
        testeAte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    }));

  const usuarios = [
    {
      nome: 'Marcos Master',
      email: 'master@oficina-exemplo.local',
      role: 'MASTER',
      permissoes: [],
    },
    {
      nome: 'Gabriel Mecânico (gerente)',
      email: 'mecanico1@oficina-exemplo.local',
      role: 'MECANICO',
      permissoes: ['GERENTE', 'GERIR_ESTOQUE'],
    },
    {
      nome: 'Lucas Mecânico',
      email: 'mecanico2@oficina-exemplo.local',
      role: 'MECANICO',
      permissoes: [],
    },
    {
      nome: 'Fernanda Financeiro',
      email: 'financeiro@oficina-exemplo.local',
      role: 'FINANCEIRO',
      permissoes: ['FINANCEIRO', 'VER_SALARIOS', 'VER_LOGS'],
    },
  ] as const;

  for (const u of usuarios) {
    await prisma.user.upsert({
      where: { oficinaId_email: { oficinaId: oficina.id, email: u.email } },
      update: { nome: u.nome, role: u.role, permissoes: [...u.permissoes] },
      create: { ...u, permissoes: [...u.permissoes], oficinaId: oficina.id, senhaHash },
    });
  }

  const emailCliente = 'cliente@exemplo.local';
  const cliente =
    (await prisma.cliente.findUnique({ where: { email: emailCliente } })) ??
    (await prisma.cliente.create({
      data: {
        nome: 'Carla Cliente',
        cpf: gerarCpf(),
        email: emailCliente,
        telefone: '11988887777',
        senhaHash,
        consentimentoLgpdEm: new Date(),
      },
    }));
  await prisma.clienteOficina.upsert({
    where: { clienteId_oficinaId: { clienteId: cliente.id, oficinaId: oficina.id } },
    update: {},
    create: { clienteId: cliente.id, oficinaId: oficina.id },
  });

  // Fase 2: horários, tabela de preços, convite e veículo.
  const horarios = [
    ...[1, 2, 3, 4, 5].map((diaSemana) => ({
      diaSemana,
      abre: '08:00',
      fecha: '18:00',
      intervaloInicio: '12:00',
      intervaloFim: '13:00',
    })),
    { diaSemana: 6, abre: '08:00', fecha: '12:00', intervaloInicio: null, intervaloFim: null },
  ];
  for (const h of horarios) {
    await prisma.horarioFuncionamento.upsert({
      where: { oficinaId_diaSemana: { oficinaId: oficina.id, diaSemana: h.diaSemana } },
      update: {},
      create: { ...h, oficinaId: oficina.id },
    });
  }

  const tabela = [
    {
      nome: 'Troca de óleo e filtro',
      tipo: 'MAO_DE_OBRA',
      precoCentavos: 8000,
      tempoEstimadoMin: 40,
    },
    {
      nome: 'Alinhamento e balanceamento',
      tipo: 'MAO_DE_OBRA',
      precoCentavos: 12000,
      tempoEstimadoMin: 60,
    },
    { nome: 'Revisão de freios', tipo: 'MAO_DE_OBRA', precoCentavos: 15000, tempoEstimadoMin: 90 },
    {
      nome: 'Diagnóstico com scanner',
      tipo: 'MAO_DE_OBRA',
      precoCentavos: 10000,
      tempoEstimadoMin: 30,
    },
    { nome: 'Óleo 5W30 sintético (1 L)', tipo: 'PECA', precoCentavos: 4990 },
    { nome: 'Filtro de óleo', tipo: 'PECA', precoCentavos: 3500 },
    { nome: 'Pastilha de freio dianteira (jogo)', tipo: 'PECA', precoCentavos: 18990 },
  ] as const;
  for (const item of tabela) {
    const existe = await prisma.itemTabelaPreco.findFirst({
      where: { oficinaId: oficina.id, nome: item.nome },
    });
    if (!existe) await prisma.itemTabelaPreco.create({ data: { ...item, oficinaId: oficina.id } });
  }

  const master = await prisma.user.findFirstOrThrow({
    where: { oficinaId: oficina.id, role: 'MASTER' },
  });
  await prisma.convite.upsert({
    where: { codigo: 'BXCERT' },
    update: {},
    create: { oficinaId: oficina.id, codigo: 'BXCERT', criadoPorId: master.id },
  });

  const veiculo = await prisma.veiculo.upsert({
    where: { clienteId_placa: { clienteId: cliente.id, placa: 'BRA2E19' } },
    update: {},
    create: {
      clienteId: cliente.id,
      placa: 'BRA2E19',
      marca: 'Chevrolet',
      modelo: 'Onix',
      ano: 2021,
      cor: 'Branco',
      combustivel: 'Flex',
    },
  });
  await prisma.veiculoOficina.upsert({
    where: { veiculoId_oficinaId: { veiculoId: veiculo.id, oficinaId: oficina.id } },
    update: {},
    create: { veiculoId: veiculo.id, oficinaId: oficina.id },
  });

  // Fase 3: agendamentos em vários status, relativos a hoje (só na primeira execução).
  if ((await prisma.agendamento.count({ where: { oficinaId: oficina.id } })) === 0) {
    const mecanico1 = await prisma.user.findFirstOrThrow({
      where: { oficinaId: oficina.id, email: 'mecanico1@oficina-exemplo.local' },
    });
    const hoje = dataLocal(new Date());
    const em = (dias: number, hora: number, duracaoMin = 60) => {
      const inicio = localParaUtc(somarDias(hoje, dias), hora * 60);
      return { inicio, fim: new Date(inicio.getTime() + duracaoMin * 60_000) };
    };
    const base = {
      oficinaId: oficina.id,
      clienteId: cliente.id,
      veiculoId: veiculo.id,
      criadoPorTipo: 'CLIENTE' as const,
      criadoPorId: cliente.id,
    };
    await prisma.agendamento.createMany({
      data: [
        {
          ...base,
          ...em(-7, 9),
          tipoServico: 'Troca de óleo',
          status: 'CONCLUIDO',
          mecanicoId: mecanico1.id,
        },
        { ...base, ...em(-2, 10), tipoServico: 'Barulho na suspensão', status: 'NAO_COMPARECEU' },
        {
          ...base,
          ...em(1, 9),
          tipoServico: 'Revisão dos freios',
          status: 'CONFIRMADO',
          mecanicoId: mecanico1.id,
        },
        { ...base, ...em(1, 14), tipoServico: 'Luz da injeção acesa', status: 'AGENDADO' },
        {
          ...base,
          ...em(3, 10),
          tipoServico: 'Alinhamento',
          status: 'CANCELADO',
          canceladoEm: new Date(),
          canceladoPorTipo: 'CLIENTE',
          motivoCancelamento: 'Viagem',
        },
      ],
    });
  }

  // Fase 5: categorias de despesa padrão e estoque com entradas (só na primeira execução).
  await prisma.categoriaDespesa.createMany({
    data: CATEGORIAS_PADRAO.map((c) => ({ ...c, oficinaId: oficina.id, padrao: true })),
    skipDuplicates: true,
  });
  if ((await prisma.estoqueItem.count({ where: { oficinaId: oficina.id } })) === 0) {
    const master = await prisma.user.findFirstOrThrow({
      where: { oficinaId: oficina.id, role: 'MASTER' },
    });
    const pecas = [
      {
        nome: 'Óleo 5W30 sintético (1 L)',
        codigo: 'OL-5W30',
        quantidade: 24,
        custo: 3200,
        preco: 4990,
        minimo: 10,
        tabela: 'Óleo 5W30 sintético (1 L)',
      },
      {
        nome: 'Filtro de óleo',
        codigo: 'FO-100',
        quantidade: 6,
        custo: 1900,
        preco: 3500,
        minimo: 4,
        tabela: 'Filtro de óleo',
      },
      {
        nome: 'Pastilha de freio dianteira (jogo)',
        codigo: 'PF-D01',
        quantidade: 3,
        custo: 11000,
        preco: 18990,
        minimo: 4,
        tabela: 'Pastilha de freio dianteira (jogo)',
      },
      {
        nome: 'Lâmpada H4',
        codigo: 'LP-H4',
        quantidade: 10,
        custo: 1500,
        preco: 2900,
        minimo: 2,
        tabela: null,
      },
    ];
    const categoriaPecasId = (
      await prisma.categoriaDespesa.findUniqueOrThrow({
        where: { oficinaId_nome: { oficinaId: oficina.id, nome: 'Peças' } },
      })
    ).id;
    for (const p of pecas) {
      const item = await prisma.estoqueItem.create({
        data: {
          oficinaId: oficina.id,
          nome: p.nome,
          codigo: p.codigo,
          quantidade: p.quantidade,
          custoCentavos: p.custo,
          precoVendaCentavos: p.preco,
          estoqueMinimo: p.minimo,
          localizacao: 'Prateleira A',
        },
      });
      const movimento = await prisma.movimentoEstoque.create({
        data: {
          oficinaId: oficina.id,
          estoqueItemId: item.id,
          tipo: 'ENTRADA',
          quantidade: p.quantidade,
          saldoQuantidade: p.quantidade,
          saldoReservada: 0,
          custoUnitarioCentavos: p.custo,
          fornecedor: 'Distribuidora Exemplo',
          atorTipo: 'USUARIO',
          usuarioId: master.id,
        },
      });
      await prisma.despesa.create({
        data: {
          oficinaId: oficina.id,
          data: new Date(),
          descricao: `Compra de estoque: ${p.nome} (${p.quantidade} un.) — fornecedor Distribuidora Exemplo`,
          valorCentavos: p.quantidade * p.custo,
          categoriaId: categoriaPecasId,
          status: 'PAGO',
          pagoEm: new Date(),
          formaPagamento: 'PIX',
          movimentoEstoqueId: movimento.id,
          criadoPorId: master.id,
        },
      });
      if (p.tabela) {
        await prisma.itemTabelaPreco.updateMany({
          where: { oficinaId: oficina.id, nome: p.tabela },
          data: { estoqueItemId: item.id },
        });
      }
    }
  }

  // Fase 6: recorrentes, contas do mês e pagamentos de funcionários (só na primeira execução).
  if ((await prisma.despesaRecorrente.count({ where: { oficinaId: oficina.id } })) === 0) {
    const master = await prisma.user.findFirstOrThrow({
      where: { oficinaId: oficina.id, role: 'MASTER' },
    });
    const mecanico2 = await prisma.user.findFirstOrThrow({
      where: { oficinaId: oficina.id, email: 'mecanico2@oficina-exemplo.local' },
    });
    const cat = Object.fromEntries(
      (await prisma.categoriaDespesa.findMany({ where: { oficinaId: oficina.id } })).map((c) => [
        c.nome,
        c.id,
      ]),
    );
    const hoje = dataLocal(new Date());
    const competencia = hoje.slice(0, 7);
    const dia = (n: number) =>
      localParaUtc(`${competencia}-${String(n).padStart(2, '0')}`, 12 * 60);
    const recorrentes = [
      { descricao: 'Aluguel do galpão', valorCentavos: 450_000, categoria: 'Aluguel', dia: 10 },
      { descricao: 'Internet', valorCentavos: 14_990, categoria: 'Internet', dia: 15 },
      { descricao: 'Energia elétrica', valorCentavos: 89_000, categoria: 'Energia', dia: 20 },
      {
        descricao: 'Salário — Lucas Mecânico',
        valorCentavos: 280_000,
        categoria: 'Salários e funcionários',
        dia: 5,
        funcionarioId: mecanico2.id,
        subtipoSalario: 'SALARIO' as const,
      },
    ];
    for (const r of recorrentes) {
      const rec = await prisma.despesaRecorrente.create({
        data: {
          oficinaId: oficina.id,
          descricao: r.descricao,
          valorCentavos: r.valorCentavos,
          categoriaId: cat[r.categoria],
          diaVencimento: r.dia,
          funcionarioId: r.funcionarioId,
          subtipoSalario: r.subtipoSalario,
          criadoPorId: master.id,
          createdAt: localParaUtc(somarDias(hoje, -90), 12 * 60),
        },
      });
      // Despesa deste mês: as que já venceram ficam pagas, as outras a pagar.
      const vencimento = dia(r.dia);
      const pago = vencimento < new Date();
      await prisma.despesa.create({
        data: {
          oficinaId: oficina.id,
          data: vencimento,
          descricao: r.descricao,
          valorCentavos: r.valorCentavos,
          categoriaId: cat[r.categoria],
          funcionarioId: r.funcionarioId,
          subtipoSalario: r.subtipoSalario,
          status: pago ? 'PAGO' : 'A_PAGAR',
          vencimento,
          pagoEm: pago ? vencimento : null,
          formaPagamento: pago ? 'PIX' : null,
          recorrenteId: rec.id,
          competencia,
          criadoPorId: master.id,
        },
      });
    }
    await prisma.despesa.create({
      data: {
        oficinaId: oficina.id,
        data: new Date(),
        descricao: 'Vale — Lucas Mecânico',
        valorCentavos: 50_000,
        categoriaId: cat['Salários e funcionários'],
        funcionarioId: mecanico2.id,
        subtipoSalario: 'VALE',
        status: 'PAGO',
        pagoEm: new Date(),
        formaPagamento: 'Dinheiro',
        criadoPorId: master.id,
      },
    });
    await prisma.despesa.create({
      data: {
        oficinaId: oficina.id,
        data: new Date(),
        descricao: 'Jogo de chaves combinadas',
        valorCentavos: 32_900,
        categoriaId: cat['Ferramentas'],
        status: 'A_PAGAR',
        vencimento: localParaUtc(somarDias(hoje, 3), 12 * 60),
        criadoPorId: master.id,
      },
    });
  }

  // Fase 4: ordens de serviço em vários status (só na primeira execução).
  if ((await prisma.ordemServico.count({ where: { oficinaId: oficina.id } })) === 0) {
    const mecanico1 = await prisma.user.findFirstOrThrow({
      where: { oficinaId: oficina.id, email: 'mecanico1@oficina-exemplo.local' },
    });
    const concluido = await prisma.agendamento.findFirst({
      where: { oficinaId: oficina.id, status: 'CONCLUIDO' },
    });
    let numero = (await prisma.oficina.findUniqueOrThrow({ where: { id: oficina.id } }))
      .proximoNumeroOS;
    const base = {
      oficinaId: oficina.id,
      clienteId: cliente.id,
      veiculoId: veiculo.id,
      mecanicoId: mecanico1.id,
    };
    const item = (
      descricao: string,
      tipo: 'PECA' | 'MAO_DE_OBRA',
      precoUnitarioCentavos: number,
      statusCliente: 'PENDENTE' | 'APROVADO' | 'RECUSADO',
      extra: Record<string, unknown> = {},
    ) => ({
      oficinaId: oficina.id,
      descricao,
      tipo,
      precoUnitarioCentavos,
      statusCliente,
      origemPeca: tipo === 'PECA' ? ('COMPRADA_SEPARADO' as const) : null,
      respondidoEm: statusCliente === 'PENDENTE' ? null : new Date(),
      ...extra,
    });

    await prisma.ordemServico.create({
      data: {
        ...base,
        numero: numero++,
        agendamentoId: concluido?.id,
        status: 'CONCLUIDA',
        kmEntrada: 42_300,
        diagnostico: 'Troca de óleo e filtro no prazo.',
        enviadoEm: new Date(),
        aprovadoEm: new Date(),
        concluidoEm: new Date(),
        statusPagamento: 'PAGO_NA_OFICINA',
        formaPagamento: 'PIX',
        pagoEm: new Date(),
        itens: {
          create: [
            item('Troca de óleo e filtro', 'MAO_DE_OBRA', 8000, 'APROVADO'),
            item('Óleo 5W30 sintético (1 L)', 'PECA', 4990, 'APROVADO', {
              quantidade: 4,
              custoUnitarioCentavos: 3200,
            }),
            item('Filtro de óleo', 'PECA', 3500, 'APROVADO', { custoUnitarioCentavos: 1900 }),
          ],
        },
      },
    });
    await prisma.ordemServico.create({
      data: {
        ...base,
        numero: numero++,
        status: 'ORCAMENTO_ENVIADO',
        kmEntrada: 45_210,
        diagnostico: 'Pastilhas dianteiras no limite e fluido de freio vencido.',
        enviadoEm: new Date(),
        descontoTipo: 'PERCENTUAL',
        descontoValor: 15,
        descontoStatus: 'PENDENTE_APROVACAO',
        descontoPorId: mecanico1.id,
        descontoMotivo: 'Cliente pediu desconto',
        descontoEm: new Date(),
        itens: {
          create: [
            item('Revisão de freios', 'MAO_DE_OBRA', 15000, 'PENDENTE'),
            item('Pastilha de freio dianteira (jogo)', 'PECA', 18990, 'PENDENTE', {
              linkAfiliado: 'https://loja.exemplo/pastilha',
            }),
            item('Fluido de freio DOT4 500 ml', 'PECA', 0, 'PENDENTE', {
              origemPeca: 'CLIENTE_COMPRA',
              linkAfiliado: 'https://loja.exemplo/fluido',
            }),
          ],
        },
      },
    });
    await prisma.ordemServico.create({
      data: { ...base, numero: numero++, status: 'ABERTA', kmEntrada: 45_400, combustivel: '1/4' },
    });
    await prisma.oficina.update({ where: { id: oficina.id }, data: { proximoNumeroOS: numero } });
  }

  console.log(
    `Oficina de exemplo: ${oficina.nome} — ${usuarios.length} usuários (${usuarios
      .map((u) => u.email)
      .join(', ')}) e cliente ${emailCliente}`,
  );
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
