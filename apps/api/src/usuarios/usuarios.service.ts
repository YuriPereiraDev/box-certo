import { Injectable, NotFoundException } from '@nestjs/common';
import { BancoService } from '../prisma/banco.service.js';
import type { AtualizarUsuarioDto } from './usuarios.dto.js';

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

/** Usuários da oficina. Sempre pelo cliente `tenant`: só enxerga a oficina do token. */
@Injectable()
export class UsuariosService {
  constructor(private readonly banco: BancoService) {}

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

  async atualizar(id: string, dto: AtualizarUsuarioDto) {
    await this.detalhar(id);
    const { motivo: _motivo, ...dados } = dto;
    return this.banco.tenant.user.update({ where: { id }, data: dados, select: SELECAO_USUARIO });
  }
}
