import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SenhaService } from '../auth/senha.service.js';
import { TokensService } from '../auth/tokens.service.js';
import { exigirOficinaId } from '../common/contexto/contexto.js';
import { contaNoLimite, PlanoService } from '../common/utils/plano.service.js';
import type { PermissaoOficina } from '../generated/prisma/client.js';
import { BancoService } from '../prisma/banco.service.js';
import type { AtualizarUsuarioDto, CriarUsuarioDto } from './usuarios.dto.js';

/** Campos que podem sair na resposta (nunca senhaHash). */
export const SELECAO_USUARIO = {
  id: true,
  oficinaId: true,
  nome: true,
  email: true,
  telefone: true,
  role: true,
  permissoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** VER_SALARIOS só faz sentido junto com FINANCEIRO (seção 4.2). */
export function validarPermissoes(permissoes: PermissaoOficina[]): void {
  if (permissoes.includes('VER_SALARIOS') && !permissoes.includes('FINANCEIRO')) {
    throw new BadRequestException('A permissão VER_SALARIOS exige também a permissão FINANCEIRO');
  }
}

/** Usuários da oficina. Sempre pelo cliente `tenant`: só enxerga a oficina do token. */
@Injectable()
export class UsuariosService {
  constructor(
    private readonly banco: BancoService,
    private readonly plano: PlanoService,
    private readonly senhas: SenhaService,
    private readonly tokens: TokensService,
  ) {}

  listar() {
    return this.banco.tenant.user.findMany({ select: SELECAO_USUARIO, orderBy: { nome: 'asc' } });
  }

  async detalhar(id: string) {
    const usuario = await this.banco.tenant.user.findUnique({
      where: { id },
      select: SELECAO_USUARIO,
    });
    if (!usuario) throw new NotFoundException('Usuário não encontrado');
    return usuario;
  }

  async criar(dto: CriarUsuarioDto) {
    const oficinaId = exigirOficinaId();
    const permissoes = dto.permissoes ?? [];
    validarPermissoes(permissoes);
    if (contaNoLimite(dto.role)) await this.plano.garantirVagaDeMecanico(oficinaId);

    const existente = await this.banco.tenant.user.findFirst({ where: { email: dto.email } });
    if (existente) throw new ConflictException('Já existe um usuário com este e-mail na oficina');

    return this.banco.tenant.user.create({
      data: {
        oficinaId,
        nome: dto.nome,
        email: dto.email,
        telefone: dto.telefone,
        role: dto.role,
        permissoes,
        senhaHash: await this.senhas.gerarHash(dto.senha),
      },
      select: SELECAO_USUARIO,
    });
  }

  async atualizar(id: string, dto: AtualizarUsuarioDto) {
    const atual = await this.detalhar(id);
    if (dto.role && dto.role !== atual.role) {
      if (atual.role === 'MASTER') {
        throw new ForbiddenException('O perfil do master não pode ser alterado');
      }
      if (atual.ativo && contaNoLimite(dto.role) && !contaNoLimite(atual.role)) {
        await this.plano.garantirVagaDeMecanico(atual.oficinaId);
      }
    }
    const { motivo: _motivo, ...dados } = dto;
    return this.banco.tenant.user.update({ where: { id }, data: dados, select: SELECAO_USUARIO });
  }

  async definirPermissoes(id: string, permissoes: PermissaoOficina[]) {
    const atual = await this.detalhar(id);
    if (atual.role === 'MASTER') {
      throw new BadRequestException('O master já tem todas as permissões');
    }
    validarPermissoes(permissoes);
    return this.banco.tenant.user.update({
      where: { id },
      data: { permissoes },
      select: SELECAO_USUARIO,
    });
  }

  async definirStatus(id: string, ativo: boolean, solicitanteId: string) {
    const atual = await this.detalhar(id);
    if (atual.role === 'MASTER' || id === solicitanteId) {
      throw new ForbiddenException('O master não pode ser desativado');
    }
    if (atual.ativo === ativo) return atual;
    if (ativo && contaNoLimite(atual.role)) {
      await this.plano.garantirVagaDeMecanico(atual.oficinaId);
    }
    const usuario = await this.banco.tenant.user.update({
      where: { id },
      data: { ativo },
      select: SELECAO_USUARIO,
    });
    if (!ativo) await this.tokens.revogarTodos('USUARIO', id);
    return usuario;
  }

  /** O master define uma nova senha para o usuário; as sessões dele são encerradas. */
  async redefinirSenha(id: string, novaSenha: string) {
    await this.detalhar(id);
    await this.banco.tenant.user.update({
      where: { id },
      data: { senhaHash: await this.senhas.gerarHash(novaSenha) },
      select: { id: true },
    });
    await this.tokens.revogarTodos('USUARIO', id);
  }
}
