import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import { categoriaPecas } from '../despesas/categorias-padrao.js';
import type { EstoqueItem, Prisma } from '../generated/prisma/client.js';
import { podeVerCusto } from '../ordens-servico/apresentacao.js';
import { BancoService, type TransacaoSistema } from '../prisma/banco.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AjusteEstoqueDto,
  AtualizarPecaDto,
  CriarPecaDto,
  EntradaEstoqueDto,
  FiltroEstoqueDto,
  FiltroMovimentosDto,
} from './estoque.dto.js';

/** Custo médio ponderado depois de uma entrada (centavos, arredondado). */
export function custoMedio(
  quantidadeAtual: number,
  custoAtual: number,
  quantidadeEntrada: number,
  custoEntrada: number,
): number {
  if (quantidadeAtual <= 0) return custoEntrada;
  const total = quantidadeAtual * custoAtual + quantidadeEntrada * custoEntrada;
  return Math.round(total / (quantidadeAtual + quantidadeEntrada));
}

/** Peça como a oficina vê: disponível, alerta de mínimo e custo só com permissão. */
export function apresentarPeca(p: EstoqueItem, ator: AtorUsuario) {
  const { custoCentavos, ...resto } = p;
  return {
    ...resto,
    ...(podeVerCusto(ator) ? { custoCentavos } : {}),
    disponivel: p.quantidade - p.quantidadeReservada,
    abaixoDoMinimo: p.ativo && p.quantidade <= p.estoqueMinimo,
  };
}

/** Estoque da oficina: cadastro, entradas (com despesa automática), ajustes e alertas. */
@Injectable()
export class EstoqueService {
  constructor(
    private readonly banco: BancoService,
    private readonly prisma: PrismaService,
  ) {}

  async listar(ator: AtorUsuario, f: FiltroEstoqueDto) {
    const termo = f.q?.trim();
    const where: Prisma.EstoqueItemWhereInput = {
      ativo: f.incluirInativos ? undefined : true,
      ...(termo
        ? {
            OR: ['nome', 'codigo', 'marca', 'aplicacao'].map((campo) => ({
              [campo]: { contains: termo, mode: 'insensitive' },
            })),
          }
        : {}),
      ...(f.alerta ? { quantidade: { lte: this.prisma.estoqueItem.fields.estoqueMinimo } } : {}),
    };
    const pecas = await this.banco.tenant.estoqueItem.findMany({ where, orderBy: { nome: 'asc' } });
    return pecas.map((p) => apresentarPeca(p, ator));
  }

  /** Peças ativas no estoque mínimo ou abaixo (seção 7.5). */
  alertas(ator: AtorUsuario) {
    return this.listar(ator, { alerta: true });
  }

  async buscar(id: string) {
    const peca = await this.banco.tenant.estoqueItem.findUnique({ where: { id } });
    if (!peca) throw new NotFoundException('Peça não encontrada');
    return peca;
  }

  async detalhar(ator: AtorUsuario, id: string) {
    return apresentarPeca(await this.buscar(id), ator);
  }

  async criar(ator: AtorUsuario, dto: CriarPecaDto) {
    const peca = await this.banco.tenant.estoqueItem.create({
      data: { ...dto, oficinaId: ator.oficinaId },
    });
    return apresentarPeca(peca, ator);
  }

  async atualizar(ator: AtorUsuario, id: string, dto: AtualizarPecaDto) {
    await this.buscar(id);
    const peca = await this.banco.tenant.estoqueItem.update({ where: { id }, data: dto });
    return apresentarPeca(peca, ator);
  }

  /** Exclusão lógica; não deixa desativar peça com reserva em OS. */
  async desativar(ator: AtorUsuario, id: string) {
    const atual = await this.buscar(id);
    if (atual.quantidadeReservada > 0) {
      throw new UnprocessableEntityException({
        codigo: 'PECA_RESERVADA',
        mensagem: `Há ${atual.quantidadeReservada} unidade(s) reservada(s) em OS. Libere antes de desativar.`,
      });
    }
    const peca = await this.banco.tenant.estoqueItem.update({
      where: { id },
      data: { ativo: false },
    });
    return apresentarPeca(peca, ator);
  }

  /** Trava a linha da peça até o fim da transação (entradas e ajustes concorrentes). */
  private async travar(tx: TransacaoSistema, id: string, oficinaId: string) {
    const linhas = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "EstoqueItem" WHERE id = ${id} AND "oficinaId" = ${oficinaId} FOR UPDATE`;
    if (linhas.length === 0) throw new NotFoundException('Peça não encontrada');
    return tx.estoqueItem.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Entrada de compra: soma a quantidade, recalcula o custo médio ponderado e, por padrão,
   * gera a despesa da compra (categoria Peças, "a pagar" salvo se marcada como paga).
   */
  async entrada(ator: AtorUsuario, id: string, dto: EntradaEstoqueDto) {
    const gerarDespesa = dto.gerarDespesa ?? true;
    const resultado = await this.banco.sistema.$transaction(async (tx) => {
      const atual = await this.travar(tx, id, ator.oficinaId);
      if (!atual.ativo) throw new UnprocessableEntityException('Peça desativada');
      const novaQuantidade = atual.quantidade + dto.quantidade;
      const peca = await tx.estoqueItem.update({
        where: { id },
        data: {
          quantidade: novaQuantidade,
          custoCentavos: custoMedio(
            atual.quantidade,
            atual.custoCentavos,
            dto.quantidade,
            dto.custoUnitarioCentavos,
          ),
        },
      });
      const movimento = await tx.movimentoEstoque.create({
        data: {
          oficinaId: ator.oficinaId,
          estoqueItemId: id,
          tipo: 'ENTRADA',
          quantidade: dto.quantidade,
          saldoQuantidade: peca.quantidade,
          saldoReservada: peca.quantidadeReservada,
          custoUnitarioCentavos: dto.custoUnitarioCentavos,
          fornecedor: dto.fornecedor,
          notaFiscal: dto.notaFiscal,
          atorTipo: ator.tipo,
          usuarioId: ator.id,
        },
      });

      let despesaId: string | null = null;
      const valor = dto.quantidade * dto.custoUnitarioCentavos;
      if (gerarDespesa && valor > 0) {
        const agora = new Date();
        const despesa = await tx.despesa.create({
          data: {
            oficinaId: ator.oficinaId,
            data: agora,
            descricao: [
              `Compra de estoque: ${atual.nome} (${dto.quantidade} un.)`,
              dto.fornecedor && `fornecedor ${dto.fornecedor}`,
              dto.notaFiscal && `NF ${dto.notaFiscal}`,
            ]
              .filter(Boolean)
              .join(' — ')
              .slice(0, 300),
            valorCentavos: valor,
            categoriaId: await categoriaPecas(tx, ator.oficinaId),
            status: dto.despesaPaga ? 'PAGO' : 'A_PAGAR',
            vencimento: dto.vencimento ?? agora,
            pagoEm: dto.despesaPaga ? agora : null,
            formaPagamento: dto.formaPagamento,
            movimentoEstoqueId: movimento.id,
            criadoPorId: ator.id,
          },
          select: { id: true },
        });
        despesaId = despesa.id;
      }
      return { peca, movimentoId: movimento.id, despesaId };
    });
    return {
      peca: apresentarPeca(resultado.peca, ator),
      movimentoId: resultado.movimentoId,
      despesaId: resultado.despesaId,
    };
  }

  /** Ajuste manual pela contagem física; motivo obrigatório e nunca abaixo do reservado. */
  async ajustar(ator: AtorUsuario, id: string, dto: AjusteEstoqueDto) {
    const peca = await this.banco.sistema.$transaction(async (tx) => {
      const atual = await this.travar(tx, id, ator.oficinaId);
      if (dto.quantidade < atual.quantidadeReservada) {
        throw new UnprocessableEntityException({
          codigo: 'ABAIXO_DO_RESERVADO',
          mensagem: `Há ${atual.quantidadeReservada} unidade(s) reservada(s) em OS; a quantidade não pode ficar abaixo disso.`,
        });
      }
      const diferenca = dto.quantidade - atual.quantidade;
      if (diferenca === 0) return atual;
      const atualizada = await tx.estoqueItem.update({
        where: { id },
        data: { quantidade: dto.quantidade },
      });
      await tx.movimentoEstoque.create({
        data: {
          oficinaId: ator.oficinaId,
          estoqueItemId: id,
          tipo: 'AJUSTE',
          quantidade: diferenca,
          saldoQuantidade: atualizada.quantidade,
          saldoReservada: atualizada.quantidadeReservada,
          motivo: dto.motivo,
          atorTipo: ator.tipo,
          usuarioId: ator.id,
        },
      });
      return atualizada;
    });
    return apresentarPeca(peca, ator);
  }

  async movimentos(ator: AtorUsuario, id: string, f: FiltroMovimentosDto) {
    await this.buscar(id);
    const where = { estoqueItemId: id };
    const [itens, total] = await Promise.all([
      this.banco.tenant.movimentoEstoque.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (f.pagina - 1) * f.limite,
        take: f.limite,
      }),
      this.banco.tenant.movimentoEstoque.count({ where }),
    ]);
    const verCusto = podeVerCusto(ator);
    return {
      itens: itens.map(({ custoUnitarioCentavos, ...m }) => ({
        ...m,
        ...(verCusto ? { custoUnitarioCentavos } : {}),
      })),
      total,
      pagina: f.pagina,
      limite: f.limite,
    };
  }
}
