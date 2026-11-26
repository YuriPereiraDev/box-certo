import { Injectable } from '@nestjs/common';
import type { TipoAtor } from '../generated/prisma/client.js';
import type { TransacaoSistema } from '../prisma/banco.service.js';

export interface AtorMovimento {
  tipo: TipoAtor;
  id: string;
}

interface ItemComEstoque {
  id: string;
  oficinaId: string;
  ordemServicoId: string;
  estoqueItemId: string | null;
  quantidade: number;
  estoqueReservado: number;
}

interface Saldo {
  quantidade: number;
  quantidadeReservada: number;
}

/**
 * Reserva, liberação e baixa de peças do estoque ligadas aos itens da OS (seção 7.5).
 * Tudo roda dentro da transação de quem chama. As alterações de saldo usam UPDATE
 * condicional (atômico): duas aprovações ao mesmo tempo nunca reservam além do disponível.
 * O histórico fica em MovimentoEstoque (auditado); o banco também tem CHECKs de saldo.
 */
@Injectable()
export class ReservasEstoqueService {
  /** Reserva a quantidade do item. Retorna false se não houver saldo disponível. */
  async reservar(
    tx: TransacaoSistema,
    item: ItemComEstoque,
    ator: AtorMovimento,
  ): Promise<boolean> {
    if (!item.estoqueItemId || item.estoqueReservado > 0) return true;
    const q = item.quantidade;
    const linhas = await tx.$queryRaw<Saldo[]>`
      UPDATE "EstoqueItem"
      SET "quantidadeReservada" = "quantidadeReservada" + ${q}, "updatedAt" = now()
      WHERE id = ${item.estoqueItemId} AND "oficinaId" = ${item.oficinaId} AND ativo
        AND quantidade - "quantidadeReservada" >= ${q}
      RETURNING quantidade, "quantidadeReservada"`;
    if (linhas.length === 0) return false;
    await tx.itemOrcamento.update({ where: { id: item.id }, data: { estoqueReservado: q } });
    await this.registrar(tx, item, 'RESERVA', q, linhas[0], ator);
    return true;
  }

  /** Devolve ao disponível a reserva do item (recusa, alteração, remoção, cancelamento). */
  async liberar(tx: TransacaoSistema, item: ItemComEstoque, ator: AtorMovimento, motivo?: string) {
    if (!item.estoqueItemId || item.estoqueReservado <= 0) return;
    const r = item.estoqueReservado;
    const linhas = await tx.$queryRaw<Saldo[]>`
      UPDATE "EstoqueItem"
      SET "quantidadeReservada" = "quantidadeReservada" - ${r}, "updatedAt" = now()
      WHERE id = ${item.estoqueItemId} AND "oficinaId" = ${item.oficinaId}
      RETURNING quantidade, "quantidadeReservada"`;
    await tx.itemOrcamento.update({ where: { id: item.id }, data: { estoqueReservado: 0 } });
    if (linhas[0]) await this.registrar(tx, item, 'LIBERACAO_RESERVA', r, linhas[0], ator, motivo);
  }

  /** Libera todas as reservas ativas da OS. */
  async liberarDaOs(
    tx: TransacaoSistema,
    ordemServicoId: string,
    ator: AtorMovimento,
    motivo: string,
  ) {
    const itens = await tx.itemOrcamento.findMany({
      where: { ordemServicoId, estoqueReservado: { gt: 0 }, estoqueBaixado: false },
    });
    for (const item of itens) await this.liberar(tx, item, ator, motivo);
  }

  /** OS concluída: SAIDA das peças reservadas (baixa quantidade e reserva). */
  async baixarDaOs(tx: TransacaoSistema, ordemServicoId: string, ator: AtorMovimento) {
    const itens = await tx.itemOrcamento.findMany({
      where: {
        ordemServicoId,
        deletedAt: null,
        statusCliente: 'APROVADO',
        estoqueReservado: { gt: 0 },
        estoqueBaixado: false,
      },
    });
    for (const item of itens) {
      const r = item.estoqueReservado;
      const linhas = await tx.$queryRaw<(Saldo & { custoCentavos: number })[]>`
        UPDATE "EstoqueItem"
        SET quantidade = quantidade - ${r}, "quantidadeReservada" = "quantidadeReservada" - ${r},
            "updatedAt" = now()
        WHERE id = ${item.estoqueItemId} AND "oficinaId" = ${item.oficinaId}
        RETURNING quantidade, "quantidadeReservada", "custoCentavos"`;
      await tx.itemOrcamento.update({
        where: { id: item.id },
        data: { estoqueReservado: 0, estoqueBaixado: true },
      });
      if (linhas[0]) {
        await this.registrar(
          tx,
          item,
          'SAIDA',
          r,
          linhas[0],
          ator,
          undefined,
          linhas[0].custoCentavos,
        );
      }
    }
  }

  private registrar(
    tx: TransacaoSistema,
    item: ItemComEstoque,
    tipo: 'RESERVA' | 'LIBERACAO_RESERVA' | 'SAIDA',
    quantidade: number,
    saldo: Saldo,
    ator: AtorMovimento,
    motivo?: string,
    custoUnitarioCentavos?: number,
  ) {
    return tx.movimentoEstoque.create({
      data: {
        oficinaId: item.oficinaId,
        estoqueItemId: item.estoqueItemId!,
        tipo,
        quantidade,
        saldoQuantidade: saldo.quantidade,
        saldoReservada: saldo.quantidadeReservada,
        custoUnitarioCentavos,
        ordemServicoId: item.ordemServicoId,
        itemOrcamentoId: item.id,
        motivo,
        atorTipo: ator.tipo,
        usuarioId: ator.id,
      },
    });
  }
}
