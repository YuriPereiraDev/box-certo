import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TotpService } from '../src/auth/totp.service.js';
import { CriptografiaService } from '../src/common/cripto/criptografia.service.js';
import { gerarCpf } from '../src/common/utils/cpf.js';
import {
  PrismaClient,
  type PermissaoOficina,
  type PermissaoPlataforma,
  type UserRole,
} from '../src/generated/prisma/client.js';
import { configurarApp, configurarSwagger } from '../src/setup-app.js';

export const SENHA = 'Senha-de-teste-123';

export async function criarApp(): Promise<INestApplication<App>> {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = modulo.createNestApplication<INestApplication<App>>();
  configurarApp(app);
  configurarSwagger(app);
  await app.init();
  return app;
}

export function criarPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
}

const sufixo = () => randomUUID().slice(0, 8);

export interface UsuarioCenario {
  id: string;
  email: string;
}

export interface OficinaCenario {
  id: string;
  master: UsuarioCenario;
  mecanico: UsuarioCenario;
  mecanicoGerente: UsuarioCenario;
  mecanicoLogs: UsuarioCenario;
}

export interface Cenario {
  a: OficinaCenario;
  b: OficinaCenario;
  cliente: { id: string; email: string; cpf: string };
  dono: AdminCenario;
  adminSemPermissao: AdminCenario;
  adminGestaoAdmins: AdminCenario;
}

export interface AdminCenario {
  id: string;
  email: string;
  segredoTotp: string;
}

/** Cria duas oficinas isoladas (A e B), um cliente vinculado à A e três admins com 2FA ativo. */
export async function criarCenario(prisma: PrismaClient, app: INestApplication): Promise<Cenario> {
  const senhaHash = await argon2.hash(SENHA, { type: argon2.argon2id });
  const plano = await prisma.plano.upsert({
    where: { nome: 'Oficina' },
    update: {},
    create: { nome: 'Oficina', precoCentavos: 11900, maxMecanicos: 5 },
  });

  const criarUsuario = async (
    oficinaId: string,
    prefixo: string,
    role: UserRole,
    permissoes: PermissaoOficina[] = [],
  ): Promise<UsuarioCenario> => {
    const email = `${prefixo}-${sufixo()}@teste.local`;
    const u = await prisma.user.create({
      data: { oficinaId, nome: prefixo, email, senhaHash, role, permissoes },
    });
    return { id: u.id, email };
  };

  const criarOficina = async (nome: string): Promise<OficinaCenario> => {
    const oficina = await prisma.oficina.create({
      data: { nome: `${nome} ${sufixo()}`, planoId: plano.id, status: 'ATIVA' },
    });
    return {
      id: oficina.id,
      master: await criarUsuario(oficina.id, 'master', 'MASTER'),
      mecanico: await criarUsuario(oficina.id, 'mecanico', 'MECANICO'),
      mecanicoGerente: await criarUsuario(oficina.id, 'gerente', 'MECANICO', ['GERENTE']),
      mecanicoLogs: await criarUsuario(oficina.id, 'logs', 'MECANICO', ['VER_LOGS']),
    };
  };

  const a = await criarOficina('Oficina A');
  const b = await criarOficina('Oficina B');

  const cpf = gerarCpf();
  const cliente = await prisma.cliente.create({
    data: {
      nome: 'Cliente Teste',
      cpf,
      email: `cliente-${sufixo()}@teste.local`,
      senhaHash,
      consentimentoLgpdEm: new Date(),
    },
  });
  await prisma.clienteOficina.create({ data: { clienteId: cliente.id, oficinaId: a.id } });

  const totp = app.get(TotpService);
  const cripto = app.get(CriptografiaService);
  const criarAdmin = async (
    prefixo: string,
    permissoes: PermissaoPlataforma[],
    isOwner = false,
  ): Promise<AdminCenario> => {
    const segredoTotp = totp.gerarSegredo();
    const email = `${prefixo}-${sufixo()}@teste.local`;
    const admin = await prisma.platformAdmin.create({
      data: {
        nome: prefixo,
        email,
        senhaHash,
        isOwner,
        permissoes,
        totpSecret: cripto.criptografar(segredoTotp),
        totpAtivadoEm: new Date(),
      },
    });
    return { id: admin.id, email, segredoTotp };
  };

  return {
    a,
    b,
    cliente: { id: cliente.id, email: cliente.email, cpf },
    dono: await criarAdmin('dono', [], true),
    adminSemPermissao: await criarAdmin('admin-sem-perm', []),
    adminGestaoAdmins: await criarAdmin('admin-gestao', ['GESTAO_ADMINS']),
  };
}

export async function tokenOficina(app: INestApplication<App>, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/oficina/login')
    .send({ email, senha: SENHA })
    .expect(200);
  return (res.body as { accessToken: string }).accessToken;
}

export async function tokenCliente(app: INestApplication<App>, login: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/cliente/login')
    .send({ login, senha: SENHA })
    .expect(200);
  return (res.body as { accessToken: string }).accessToken;
}

export async function tokenAdmin(app: INestApplication<App>, admin: AdminCenario): Promise<string> {
  const codigoTotp = app.get(TotpService).gerarCodigo(admin.segredoTotp);
  const res = await request(app.getHttpServer())
    .post('/auth/plataforma/login')
    .send({ email: admin.email, senha: SENHA, codigoTotp })
    .expect(200);
  return (res.body as { accessToken: string }).accessToken;
}
