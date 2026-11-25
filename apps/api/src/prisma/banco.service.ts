import { Injectable } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { contextoAtual, oficinaIdAtual } from '../common/contexto/contexto.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { extensaoAuditoria } from './extensao-auditoria.js';
import { extensaoTenant } from './extensao-tenant.js';
import { PrismaService } from './prisma.service.js';

function criarClienteSistema(base: PrismaClient, auditoria: AuditoriaService) {
  return base.$extends(
    extensaoAuditoria(base, async (alteracao) => {
      const contexto = contextoAtual();
      if (contexto) {
        contexto.alteracoes.push(alteracao);
      } else {
        // Fora de requisição (jobs, scripts): grava na hora como SISTEMA.
        await auditoria.gravar(auditoria.entradaDeAlteracao(alteracao, {}));
      }
    }),
  );
}

function criarClienteTenant(sistema: ReturnType<typeof criarClienteSistema>) {
  // A extensão de tenant fica por fora: injeta oficinaId antes da auditoria ler "antes".
  return sistema.$extends(extensaoTenant(oficinaIdAtual));
}

export type ClienteSistema = ReturnType<typeof criarClienteSistema>;
export type ClienteTenant = ReturnType<typeof criarClienteTenant>;

/**
 * Pontos de acesso ao banco para os services:
 * - `tenant`: para usuários da oficina. Filtra tudo pelo `oficinaId` do token. Use por padrão.
 * - `sistema`: sem filtro de oficina (plataforma, cliente, auth). Também auditado.
 */
@Injectable()
export class BancoService {
  readonly sistema: ClienteSistema;
  readonly tenant: ClienteTenant;

  constructor(prisma: PrismaService, auditoria: AuditoriaService) {
    this.sistema = criarClienteSistema(prisma, auditoria);
    this.tenant = criarClienteTenant(this.sistema);
  }
}
