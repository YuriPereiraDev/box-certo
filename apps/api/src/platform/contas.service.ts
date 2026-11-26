import { Injectable, NotFoundException } from '@nestjs/common';
import { SenhaService } from '../auth/senha.service.js';
import { TokensService } from '../auth/tokens.service.js';
import { somenteDigitos } from '../common/utils/cpf.js';
import { BancoService } from '../prisma/banco.service.js';
import { gerarSenhaTemporaria } from './regras.js';

/**
 * Contas de usuários das oficinas e de clientes (GESTAO_USUARIOS): busca, bloqueio e
 * reset de senha. Bloquear e resetar encerram as sessões da pessoa.
 */
@Injectable()
export class ContasService {
  constructor(
    private readonly banco: BancoService,
    private readonly senhas: SenhaService,
    private readonly tokens: TokensService,
  ) {}

  async buscar(q: string) {
    const termo = q.trim();
    const digitos = somenteDigitos(termo);
    const texto = (campo: string) => ({
      [campo]: { contains: termo, mode: 'insensitive' as const },
    });
    const [usuarios, clientes] = await Promise.all([
      this.banco.sistema.user.findMany({
        where: { OR: [texto('nome'), texto('email')] },
        select: {
          id: true,
          nome: true,
          email: true,
          telefone: true,
          role: true,
          ativo: true,
          createdAt: true,
          oficina: { select: { id: true, nome: true, status: true } },
        },
        take: 50,
        orderBy: { nome: 'asc' },
      }),
      this.banco.sistema.cliente.findMany({
        where: {
          OR: [
            texto('nome'),
            texto('email'),
            ...(digitos.length >= 3 ? [{ cpf: { contains: digitos } }] : []),
          ],
        },
        select: {
          id: true,
          nome: true,
          email: true,
          cpf: true,
          telefone: true,
          ativo: true,
          createdAt: true,
          oficinas: { select: { oficina: { select: { id: true, nome: true } } } },
        },
        take: 50,
        orderBy: { nome: 'asc' },
      }),
    ]);
    return {
      usuarios,
      clientes: clientes.map(({ oficinas, ...c }) => ({
        ...c,
        oficinas: oficinas.map((o) => o.oficina),
      })),
    };
  }

  async statusUsuario(id: string, ativo: boolean) {
    const existe = await this.banco.sistema.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Usuário não encontrado');
    await this.banco.sistema.user.update({ where: { id }, data: { ativo } });
    if (!ativo) await this.tokens.revogarTodos('USUARIO', id);
    return { id, ativo };
  }

  async statusCliente(id: string, ativo: boolean) {
    const existe = await this.banco.sistema.cliente.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Cliente não encontrado');
    await this.banco.sistema.cliente.update({ where: { id }, data: { ativo } });
    if (!ativo) await this.tokens.revogarTodos('CLIENTE', id);
    return { id, ativo };
  }

  /** Gera senha temporária (mostrada uma vez ao admin). Envio por e-mail: fase 11. */
  async resetarUsuario(id: string) {
    const existe = await this.banco.sistema.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Usuário não encontrado');
    const senhaTemporaria = gerarSenhaTemporaria();
    await this.banco.sistema.user.update({
      where: { id },
      data: { senhaHash: await this.senhas.gerarHash(senhaTemporaria) },
    });
    await this.tokens.revogarTodos('USUARIO', id);
    return { senhaTemporaria };
  }

  async resetarCliente(id: string) {
    const existe = await this.banco.sistema.cliente.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Cliente não encontrado');
    const senhaTemporaria = gerarSenhaTemporaria();
    await this.banco.sistema.cliente.update({
      where: { id },
      data: { senhaHash: await this.senhas.gerarHash(senhaTemporaria) },
    });
    await this.tokens.revogarTodos('CLIENTE', id);
    return { senhaTemporaria };
  }
}
