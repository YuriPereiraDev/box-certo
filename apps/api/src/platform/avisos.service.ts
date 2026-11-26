import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AtorPlataforma } from '../common/contexto/contexto.js';
import { BancoService } from '../prisma/banco.service.js';
import type { AtualizarAvisoDto, AvisoDto } from './plataforma.dto.js';

/** Avisos globais (admins com SUPORTE gerenciam; todos os usuários logados leem os vigentes). */
@Injectable()
export class AvisosService {
  constructor(private readonly banco: BancoService) {}

  listar() {
    return this.banco.sistema.avisoGlobal.findMany({ orderBy: { inicio: 'desc' } });
  }

  /** Avisos que estão valendo agora. */
  vigentes() {
    const agora = new Date();
    return this.banco.sistema.avisoGlobal.findMany({
      where: { ativo: true, inicio: { lte: agora }, OR: [{ fim: null }, { fim: { gt: agora } }] },
      select: { id: true, titulo: true, mensagem: true, inicio: true, fim: true },
      orderBy: { inicio: 'desc' },
    });
  }

  private validarPeriodo(inicio: Date, fim?: Date | null) {
    if (fim && fim <= inicio) throw new BadRequestException('O fim precisa ser depois do início');
  }

  criar(admin: AtorPlataforma, dto: AvisoDto) {
    const inicio = dto.inicio ?? new Date();
    this.validarPeriodo(inicio, dto.fim);
    return this.banco.sistema.avisoGlobal.create({
      data: { ...dto, inicio, criadoPorId: admin.id },
    });
  }

  async atualizar(id: string, dto: AtualizarAvisoDto) {
    const atual = await this.banco.sistema.avisoGlobal.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Aviso não encontrado');
    this.validarPeriodo(dto.inicio ?? atual.inicio, dto.fim ?? atual.fim);
    return this.banco.sistema.avisoGlobal.update({ where: { id }, data: dto });
  }
}
