import { ForbiddenException } from '@nestjs/common';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import type { StatusDesconto } from '../generated/prisma/client.js';

export interface ParametrosDescontoOficina {
  mecanicoPodeDarDesconto: boolean;
  limiteDescontoPercentual: number | null;
  limiteDescontoCentavos: number | null;
}

/** MASTER e GERENTE dão desconto em qualquer OS, sem limite (seção 7.4). */
export function podeAprovarDesconto(ator: AtorUsuario): boolean {
  return ator.role === 'MASTER' || ator.permissoes.includes('GERENTE');
}

/** O desconto passa de algum limite da oficina? */
export function excedeLimite(
  descontoCentavos: number,
  baseCentavos: number,
  p: ParametrosDescontoOficina,
): boolean {
  if (p.limiteDescontoCentavos !== null && descontoCentavos > p.limiteDescontoCentavos) return true;
  if (
    p.limiteDescontoPercentual !== null &&
    descontoCentavos * 100 > p.limiteDescontoPercentual * baseCentavos
  ) {
    return true;
  }
  return false;
}

/**
 * Decide o status de um desconto pedido por um usuário da oficina:
 * - MASTER/GERENTE: APLICADO;
 * - mecânico na própria OS: APLICADO se a oficina permite e está dentro do limite;
 *   senão PENDENTE_APROVACAO (master ou gerente aprova);
 * - demais: 403.
 */
export function decidirDesconto(
  ator: AtorUsuario,
  mecanicoDaOs: string,
  descontoCentavos: number,
  baseCentavos: number,
  p: ParametrosDescontoOficina,
): StatusDesconto {
  if (podeAprovarDesconto(ator)) return 'APLICADO';
  if (ator.role !== 'MECANICO' || ator.id !== mecanicoDaOs) {
    throw new ForbiddenException('Só o mecânico da OS, um gerente ou o master podem dar desconto');
  }
  if (!p.mecanicoPodeDarDesconto) return 'PENDENTE_APROVACAO';
  return excedeLimite(descontoCentavos, baseCentavos, p) ? 'PENDENTE_APROVACAO' : 'APLICADO';
}
