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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
