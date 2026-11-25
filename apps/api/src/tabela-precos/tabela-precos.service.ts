import { Injectable, NotFoundException } from '@nestjs/common';
import { exigirOficinaId } from '../common/contexto/contexto.js';
import { BancoService } from '../prisma/banco.service.js';
import type {
  AtualizarItemTabelaDto,
  CriarItemTabelaDto,
  FiltroTabelaDto,
} from './tabela-precos.dto.js';

/** Tabela interna de preços da oficina (o cliente nunca vê). */
@Injectable()
export class TabelaPrecosService {
  constructor(private readonly banco: BancoService) {}

  listar(f: FiltroTabelaDto) {
    return this.banco.tenant.itemTabelaPreco.findMany({
      where: {
        tipo: f.tipo,
        ativo: f.incluirInativos ? undefined : true,
        nome: f.q ? { contains: f.q, mode: 'insensitive' } : undefined,
      },
      orderBy: { nome: 'asc' },
    });
  }

  async detalhar(id: string) {
    const item = await this.banco.tenant.itemTabelaPreco.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item da tabela não encontrado');
    return item;
  }

  criar(dto: CriarItemTabelaDto) {
    return this.banco.tenant.itemTabelaPreco.create({
      data: {
        ...dto,
        oficinaId: exigirOficinaId(),
        linkAfiliadoPadrao: dto.tipo === 'PECA' ? dto.linkAfiliadoPadrao : null,
      },
    });
  }

  async atualizar(id: string, dto: AtualizarItemTabelaDto) {
    const atual = await this.detalhar(id);
    const tipo = dto.tipo ?? atual.tipo;
    return this.banco.tenant.itemTabelaPreco.update({
      where: { id },
      data: { ...dto, ...(tipo === 'MAO_DE_OBRA' ? { linkAfiliadoPadrao: null } : {}) },
    });
  }

  /** Exclusão lógica. */
  async desativar(id: string) {
    await this.detalhar(id);
    return this.banco.tenant.itemTabelaPreco.update({ where: { id }, data: { ativo: false } });
  }
}
