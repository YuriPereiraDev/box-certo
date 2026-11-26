import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import { dataLocal, localParaUtc, somarDias } from '../common/utils/datas.js';
import { ROLES_QUE_CONTAM } from '../common/utils/plano.service.js';
import { DespesasService } from '../despesas/despesas.service.js';
import { podeVerSalarios } from '../despesas/regras.js';
import type { Prisma } from '../generated/prisma/client.js';
import { valoresDoItem } from '../ordens-servico/calculo.js';
import { BancoService } from '../prisma/banco.service.js';
import {
  cardsDeFaturamento,
  custoDasPecas,
  faturamentoPorMes,
  maisFeitos,
  mesesAte,
  porMecanico,
  type OsParaIndicador,
} from './agregacoes.js';
import type { FiltroDashboardDto } from './dashboard.dto.js';

const SELECAO_OS = {
  id: true,
  mecanicoId: true,
  pagoEm: true,
  concluidoEm: true,
  descontoTipo: true,
  descontoValor: true,
  descontoStatus: true,
  itens: {
    where: { deletedAt: null },
    select: {
      descricao: true,
      tipo: true,
      quantidade: true,
      precoUnitarioCentavos: true,
      custoUnitarioCentavos: true,
      descontoTipo: true,
      descontoValor: true,
      descontoStatus: true,
      statusCliente: true,
      tabelaPrecoId: true,
      estoqueItemId: true,
    },
  },
} as const satisfies Prisma.OrdemServicoSelect;

/** Dashboard: MASTER, GERENTE ou permissão FINANCEIRO; mecânico comum não acessa. */
export function podeVerDashboard(ator: AtorUsuario): boolean {
  return (
    ator.role === 'MASTER' ||
    ator.permissoes.includes('GERENTE') ||
    ator.permissoes.includes('FINANCEIRO')
  );
}

/** Bloco financeiro (lucro, despesas, contas a vencer, custo de peças): MASTER ou FINANCEIRO. */
export function podeVerFinanceiro(ator: AtorUsuario): boolean {
  return ator.role === 'MASTER' || ator.permissoes.includes('FINANCEIRO');
}

export type Dashboard = Awaited<ReturnType<DashboardService['montar']>>;

/**
 * Indicadores do master (seção 10). Definições (decisão da fase 7):
 * - faturamento = valor aprovado das OS **pagas** no período (regime de caixa);
 * - lucro = faturamento do período − despesas com data no período (pagas ou a pagar).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly banco: BancoService,
    private readonly despesas: DespesasService,
  ) {}

  periodo(f: FiltroDashboardDto) {
    const hoje = dataLocal(new Date());
    const de = f.de ?? `${hoje.slice(0, 7)}-01`;
    const ate = f.ate ?? hoje;
    if (de > ate) throw new BadRequestException('O início do período deve ser antes do fim');
    return { de, ate, inicio: localParaUtc(de, 0), fim: localParaUtc(somarDias(ate, 1), 0) };
  }

  private pagasEntre(inicio: Date, fim: Date, filtro: Prisma.OrdemServicoWhereInput) {
    return this.banco.tenant.ordemServico.findMany({
      where: { statusPagamento: 'PAGO_NA_OFICINA', pagoEm: { gte: inicio, lt: fim }, ...filtro },
      select: SELECAO_OS,
    }) as Promise<OsParaIndicador[]>;
  }

  async montar(ator: AtorUsuario, f: FiltroDashboardDto) {
    if (!podeVerDashboard(ator)) {
      throw new ForbiddenException('O dashboard é do master, dos gerentes e do financeiro');
    }
    const { de, ate, inicio, fim } = this.periodo(f);
    const filtroMec: Prisma.OrdemServicoWhereInput = f.mecanicoId
      ? { mecanicoId: f.mecanicoId }
      : {};
    const hoje = dataLocal(new Date());
    const meses = mesesAte(ate.slice(0, 7), 12);

    const [pagas, concluidas, aReceber, respondidos, agendaHoje, aguardando, pagas12, mecanicos] =
      await Promise.all([
        this.pagasEntre(inicio, fim, filtroMec),
        this.banco.tenant.ordemServico.findMany({
          where: { status: 'CONCLUIDA', concluidoEm: { gte: inicio, lt: fim }, ...filtroMec },
          select: SELECAO_OS,
        }) as Promise<OsParaIndicador[]>,
        this.banco.tenant.ordemServico.findMany({
          where: { status: 'CONCLUIDA', statusPagamento: 'PENDENTE', ...filtroMec },
          select: SELECAO_OS,
        }) as Promise<OsParaIndicador[]>,
        this.banco.tenant.itemOrcamento.findMany({
          where: {
            deletedAt: null,
            substituiItemId: null, // "peça trazida pelo cliente" não é resposta a orçamento
            respondidoEm: { gte: inicio, lt: fim },
            statusCliente: { in: ['APROVADO', 'RECUSADO'] },
            ordemServico: filtroMec,
          },
          select: {
            statusCliente: true,
            quantidade: true,
            precoUnitarioCentavos: true,
            descontoTipo: true,
            descontoValor: true,
            descontoStatus: true,
          },
        }),
        this.banco.tenant.agendamento.groupBy({
          by: ['status'],
          where: {
            inicio: { gte: localParaUtc(hoje, 0), lt: localParaUtc(somarDias(hoje, 1), 0) },
            ...(f.mecanicoId ? { mecanicoId: f.mecanicoId } : {}),
          },
          _count: true,
        }),
        this.banco.tenant.ordemServico.count({
          where: { status: 'ORCAMENTO_ENVIADO', ...filtroMec },
        }),
        this.pagasEntre(localParaUtc(`${meses[0]}-01`, 0), fim, filtroMec),
        this.banco.tenant.user.findMany({
          where: {
            role: { in: [...ROLES_QUE_CONTAM] },
            ...(f.mecanicoId ? { id: f.mecanicoId } : { ativo: true }),
          },
          select: { id: true, nome: true },
          orderBy: { nome: 'asc' },
        }),
      ]);

    const resposta = (status: 'APROVADO' | 'RECUSADO') => {
      const itens = respondidos.filter((i) => i.statusCliente === status);
      return {
        quantidade: itens.length,
        valorCentavos: itens.reduce((s, i) => s + valoresDoItem(i).totalCentavos, 0),
      };
    };
    const agendamentos = Object.fromEntries(agendaHoje.map((g) => [g.status, g._count]));
    const cards = cardsDeFaturamento(pagas);

    return {
      periodo: { de, ate },
      mecanicoId: f.mecanicoId ?? null,
      cards: {
        ...cards,
        aReceberCentavos: cardsDeFaturamento(aReceber).faturamentoCentavos,
        orcamentos: {
          aprovados: resposta('APROVADO'),
          recusados: resposta('RECUSADO'),
          aguardandoResposta: aguardando,
        },
        agendamentosHoje: {
          total: agendaHoje
            .filter((g) => g.status !== 'CANCELADO')
            .reduce((s, g) => s + g._count, 0),
          porStatus: agendamentos,
        },
      },
      graficos: {
        faturamentoPorMes: faturamentoPorMes(pagas12, meses),
        porMecanico: porMecanico(pagas, concluidas, mecanicos),
        maisFeitos: maisFeitos(pagas),
      },
      financeiro: podeVerFinanceiro(ator)
        ? await this.financeiro(ator, de, ate, inicio, fim, f, pagas)
        : null,
    };
  }

  /** Receitas − despesas do período (o bloco é sempre da oficina inteira). */
  private async financeiro(
    ator: AtorUsuario,
    de: string,
    ate: string,
    inicio: Date,
    fim: Date,
    f: FiltroDashboardDto,
    pagasDoFiltro: OsParaIndicador[],
  ) {
    const pagas = f.mecanicoId ? await this.pagasEntre(inicio, fim, {}) : pagasDoFiltro;
    const receitas = cardsDeFaturamento(pagas).faturamentoCentavos;
    const resumo = await this.despesas.resumo(ator, de, ate);
    return {
      receitasCentavos: receitas,
      despesasCentavos: resumo.totalCentavos,
      lucroCentavos: receitas - resumo.totalCentavos,
      // Sem VER_SALARIOS, salários ficam de fora das despesas (e o lucro aparece maior).
      incluiSalarios: podeVerSalarios(ator),
      despesasPagasCentavos: resumo.pagoCentavos,
      despesasAPagarCentavos: resumo.aPagarCentavos,
      despesasPorCategoria: resumo.porCategoria,
      custoPecasVendidasCentavos: custoDasPecas(pagas),
      contasAVencer7DiasCentavos: resumo.aVencerEm7DiasCentavos,
      contasVencidasCentavos: resumo.vencidasCentavos,
    };
  }
}
