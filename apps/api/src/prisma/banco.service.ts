import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { contextoAtual, oficinaIdAtual } from '../common/contexto/contexto.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { extensaoAuditoria, type ClienteDeEscrita } from './extensao-auditoria.js';
import { extensaoTenant } from './extensao-tenant.js';
import { PrismaService } from './prisma.service.js';

/**
 * Transação interativa em andamento (`$transaction(async (tx) => ...)`). A extensão de
 * auditoria usa este `tx` para gravar o AuditLog junto com a alteração: se um falhar, os dois
 * são desfeitos ("nada pode passar despercebido").
 */
const transacaoAtual = new AsyncLocalStorage<ClienteDeEscrita>();

function criarClienteSistema(base: PrismaClient, auditoria: AuditoriaService) {
  return base.$extends(
    extensaoAuditoria(base, {
      transacaoAtual: () => transacaoAtual.getStore(),
      montarLog: (alteracao) => {
        const contexto = contextoAtual();
        // Marca para o interceptor saber que a requisição alterou algo.
        contexto?.alteracoes.push(alteracao);
        return auditoria.dadosDoLog(
          auditoria.entradaDeAlteracao(alteracao, contexto ?? {}, contexto?.auditoria),
        );
      },
    }),
  );
}

function criarClienteTenant(sistema: ReturnType<typeof criarClienteSistema>) {
  // A extensão de tenant fica por fora: injeta oficinaId antes da auditoria ler "antes".
  return sistema.$extends(extensaoTenant(oficinaIdAtual));
}

/**
 * Envolve `$transaction` para registrar o `tx` em andamento (só a forma com callback; a forma
 * em lote não é usada no projeto).
 */
function rastrearTransacoes<C extends object>(cliente: C): C {
  return new Proxy(cliente, {
    get(alvo, prop, receptor) {
      const valor: unknown = Reflect.get(alvo, prop, receptor);
      if (prop !== '$transaction' || typeof valor !== 'function') return valor;
      return (arg: unknown, opcoes?: unknown) =>
        typeof arg === 'function'
          ? (valor as (fn: unknown, o?: unknown) => unknown).call(
              alvo,
              (tx: ClienteDeEscrita) =>
                transacaoAtual.run(tx, () => (arg as (t: unknown) => unknown)(tx)),
              opcoes,
            )
          : (valor as (a: unknown, o?: unknown) => unknown).call(alvo, arg, opcoes);
    },
  });
}

export type ClienteSistema = ReturnType<typeof criarClienteSistema>;
export type ClienteTenant = ReturnType<typeof criarClienteTenant>;

/**
 * Pontos de acesso ao banco para os services:
 * - `tenant`: para usuários da oficina. Filtra tudo pelo `oficinaId` do token. Use por padrão.
 * - `sistema`: sem filtro de oficina (plataforma, cliente, auth). Também auditado.
 * Toda escrita grava o AuditLog na mesma transação.
 */
@Injectable()
export class BancoService {
  readonly sistema: ClienteSistema;
  readonly tenant: ClienteTenant;

  constructor(prisma: PrismaService, auditoria: AuditoriaService) {
    const sistema = criarClienteSistema(prisma, auditoria);
    this.sistema = rastrearTransacoes(sistema);
    this.tenant = rastrearTransacoes(criarClienteTenant(sistema));
  }
}

/** Cliente dentro de `banco.sistema.$transaction(async (tx) => ...)`. */
export type TransacaoSistema = Parameters<Parameters<ClienteSistema['$transaction']>[0]>[0];
