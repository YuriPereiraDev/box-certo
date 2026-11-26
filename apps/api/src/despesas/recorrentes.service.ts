import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import { FUSO_PADRAO } from '../common/utils/datas.js';
import { Prisma, type DespesaRecorrente } from '../generated/prisma/client.js';
import { BancoService } from '../prisma/banco.service.js';
import type { AtualizarRecorrenteDto, RecorrenteDto } from './despesas.dto.js';
import { DespesasService } from './despesas.service.js';
import {
  competenciaDe,
  deveGerarNaCompetencia,
  podeVerSalarios,
  vencimentoNaCompetencia,
} from './regras.js';

const INCLUDE_RECORRENTE = {
  categoria: { select: { id: true, nome: true, ehSalario: true } },
  funcionario: { select: { id: true, nome: true, ativo: true } },
} as const satisfies Prisma.DespesaRecorrenteInclude;

/**
 * Despesas recorrentes (aluguel, internet, salário fixo...). A despesa do mês é gerada no
 * dia 1º por um job diário (idempotente: uma por recorrente e competência). Cadastrada no
 * meio do mês, já gera a do mês atual se o vencimento ainda não passou.
 */
@Injectable()
export class RecorrentesService {
  private readonly logger = new Logger(RecorrentesService.name);

  constructor(
    private readonly banco: BancoService,
    private readonly despesas: DespesasService,
  ) {}

  private filtro(ator: AtorUsuario): Prisma.DespesaRecorrenteWhereInput {
    return podeVerSalarios(ator) ? {} : { categoria: { ehSalario: false } };
  }

  listar(ator: AtorUsuario) {
    return this.banco.tenant.despesaRecorrente.findMany({
      where: this.filtro(ator),
      include: INCLUDE_RECORRENTE,
      orderBy: [{ ativa: 'desc' }, { diaVencimento: 'asc' }],
    });
  }

  async buscar(ator: AtorUsuario, id: string) {
    const r = await this.banco.tenant.despesaRecorrente.findFirst({
      where: { id, ...this.filtro(ator) },
      include: INCLUDE_RECORRENTE,
    });
    if (!r) throw new NotFoundException('Despesa recorrente não encontrada');
    return r;
  }

  async criar(ator: AtorUsuario, dto: RecorrenteDto) {
    await this.despesas.validarClassificacao(
      ator,
      dto.categoriaId,
      dto.funcionarioId,
      dto.subtipoSalario,
    );
    const recorrente = await this.banco.tenant.despesaRecorrente.create({
      data: { ...dto, oficinaId: ator.oficinaId, criadoPorId: ator.id },
    });
    const gerada = await this.gerar(recorrente, competenciaDe(new Date()));
    return { ...(await this.buscar(ator, recorrente.id)), despesaGeradaId: gerada };
  }

  /** Alterações valem a partir da próxima despesa gerada. */
  async atualizar(ator: AtorUsuario, id: string, dto: AtualizarRecorrenteDto) {
    const atual = await this.buscar(ator, id);
    const categoria = await this.despesas.validarClassificacao(
      ator,
      dto.categoriaId ?? atual.categoriaId,
      dto.funcionarioId !== undefined ? dto.funcionarioId : atual.funcionarioId,
      dto.subtipoSalario !== undefined ? dto.subtipoSalario : atual.subtipoSalario,
    );
    await this.banco.tenant.despesaRecorrente.update({
      where: { id },
      data: {
        ...dto,
        ...(categoria.ehSalario ? {} : { funcionarioId: null, subtipoSalario: null }),
      },
    });
    return this.buscar(ator, id);
  }

  async desativar(ator: AtorUsuario, id: string) {
    await this.buscar(ator, id);
    await this.banco.tenant.despesaRecorrente.update({ where: { id }, data: { ativa: false } });
    return this.buscar(ator, id);
  }

  /** Gera agora as despesas do mês que faltam nesta oficina (o job faz isso todo dia). */
  async gerarDoMes(ator: AtorUsuario) {
    const competencia = competenciaDe(new Date());
    const recorrentes = await this.banco.tenant.despesaRecorrente.findMany({
      where: {
        ativa: true,
        ...this.filtro(ator),
        OR: [{ funcionarioId: null }, { funcionario: { ativo: true } }],
      },
    });
    const geradas: string[] = [];
    for (const r of recorrentes) {
      const id = await this.gerar(r, competencia);
      if (id) geradas.push(id);
    }
    return { competencia, geradas: geradas.length, despesas: geradas };
  }

  /** Job diário (00:10 em São Paulo): gera as despesas do mês de todas as oficinas. */
  @Cron('0 10 0 * * *', {
    name: 'despesas-recorrentes',
    timeZone: FUSO_PADRAO,
    disabled: process.env.NODE_ENV === 'test',
  })
  async gerarTodas(referencia = new Date()): Promise<number> {
    const competencia = competenciaDe(referencia);
    const recorrentes = await this.banco.sistema.despesaRecorrente.findMany({
      where: {
        ativa: true,
        oficina: { deletedAt: null, status: { notIn: ['CANCELADA'] } },
        OR: [{ funcionarioId: null }, { funcionario: { ativo: true } }],
      },
    });
    let geradas = 0;
    for (const r of recorrentes) {
      try {
        if (await this.gerar(r, competencia)) geradas++;
      } catch (erro) {
        this.logger.error(`Falha ao gerar a recorrente ${r.id}`, erro as Error);
      }
    }
    if (geradas)
      this.logger.log(`${geradas} despesa(s) recorrente(s) gerada(s) para ${competencia}`);
    return geradas;
  }

  /** Cria a despesa da competência (uma só por recorrente/mês). Devolve o id ou null. */
  private async gerar(r: DespesaRecorrente, competencia: string): Promise<string | null> {
    if (!deveGerarNaCompetencia(r.createdAt, competencia, r.diaVencimento)) return null;
    const vencimento = vencimentoNaCompetencia(competencia, r.diaVencimento);
    try {
      const despesa = await this.banco.sistema.despesa.create({
        data: {
          oficinaId: r.oficinaId,
          data: vencimento,
          descricao: r.descricao,
          valorCentavos: r.valorCentavos,
          categoriaId: r.categoriaId,
          funcionarioId: r.funcionarioId,
          subtipoSalario: r.subtipoSalario,
          formaPagamento: r.formaPagamento,
          status: 'A_PAGAR',
          vencimento,
          recorrenteId: r.id,
          competencia,
          criadoPorId: r.criadoPorId,
        },
        select: { id: true },
      });
      return despesa.id;
    } catch (erro) {
      // Já gerada para este mês (unique recorrenteId + competência).
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002')
        return null;
      throw erro;
    }
  }
}
