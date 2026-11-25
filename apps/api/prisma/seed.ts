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

  const nomeOficina = 'Oficina Exemplo Box Certo';
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
