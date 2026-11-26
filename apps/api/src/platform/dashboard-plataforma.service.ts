import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AtorPlataforma } from '../common/contexto/contexto.js';
import { dataLocal, localParaUtc, somarDias } from '../common/utils/datas.js';
import { ROLES_QUE_CONTAM } from '../common/utils/plano.service.js';
import { mesesAte, mesLocal, valorDaOs, type OsParaIndicador } from '../dashboards/agregacoes.js';
import { BancoService } from '../prisma/banco.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { mensalidade } from './oficinas-plataforma.service.js';
import { podeVerValores } from './regras.js';

/**
 * Dashboard da plataforma (seção 10). Valores (faturamento do Box Certo e ranking de
 * faturamento das oficinas) só para o dono ou admins com FINANCEIRO; para os demais vêm null.
 * Tickets entram na fase 9.
 */
@Injectable()
export class DashboardPlataformaService {
  private readonly inicio = Date.now();

  constructor(
    private readonly banco: BancoService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async montar(admin: AtorPlataforma) {
    const db = this.banco.sistema;
    const hoje = dataLocal(new Date());
    const competencia = hoje.slice(0, 7);
    const inicioMes = localParaUtc(`${competencia}-01`, 0);
    const meses = mesesAte(competencia, 12);
    const inicio12 = localParaUtc(`${meses[0]}-01`, 0);

    const [porStatus, criadas, canceladasNoMes, testesAcabando, mecanicos, clientes] =
      await Promise.all([
        db.oficina.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
        db.oficina.findMany({
          where: { deletedAt: null, createdAt: { gte: inicio12 } },
          select: { createdAt: true },
        }),
        db.oficina.count({
          where: { deletedAt: null, status: 'CANCELADA', canceladaEm: { gte: inicioMes } },
        }),
        db.oficina.findMany({
          where: {
            deletedAt: null,
            status: 'TESTE',
            testeAte: { lt: localParaUtc(somarDias(hoje, 8), 0) },
          },
          select: { id: true, nome: true, testeAte: true, email: true, telefone: true },
          orderBy: { testeAte: 'asc' },
        }),
        db.user.count({
          where: { ativo: true, role: { in: [...ROLES_QUE_CONTAM] }, oficina: { deletedAt: null } },
        }),
        db.cliente.count({ where: { ativo: true } }),
      ]);

    const status = Object.fromEntries(porStatus.map((s) => [s.status, s._count]));
    const contagem = { TESTE: 0, ATIVA: 0, SUSPENSA: 0, CANCELADA: 0, ...status };
    const novas = new Map(meses.map((m) => [m, 0]));
    for (const o of criadas) {
      const m = mesLocal(o.createdAt);
      if (novas.has(m)) novas.set(m, novas.get(m)! + 1);
    }
    // Churn do mês ≈ canceladas no mês ÷ (ativas agora + canceladas no mês).
    const baseChurn = contagem.ATIVA + canceladasNoMes;

    return {
      oficinas: {
        porStatus: contagem,
        total: Object.values(contagem).reduce((s, n) => s + n, 0),
        novasPorMes: meses.map((mes) => ({ mes, quantidade: novas.get(mes)! })),
        canceladasNoMes,
        churnMesPercentual: baseChurn ? Math.round((canceladasNoMes / baseChurn) * 1000) / 10 : 0,
        testesAcabandoEm7Dias: testesAcabando.map((o) => ({
          ...o,
          vencido: !!o.testeAte && o.testeAte < new Date(),
        })),
      },
      totais: { mecanicosAtivos: mecanicos, clientesAtivos: clientes },
      financeiro: podeVerValores(admin) ? await this.financeiro(inicioMes) : null,
      tickets: null, // fase 9
    };
  }

  /** Só com FINANCEIRO: faturamento do Box Certo e ranking das oficinas que mais faturam. */
  private async financeiro(inicioMes: Date) {
    const db = this.banco.sistema;
    const ativas = await db.oficina.findMany({
      where: { deletedAt: null, status: 'ATIVA' },
      select: { precoFundadorCentavos: true, plano: { select: { precoCentavos: true } } },
    });
    const pagas = (await db.ordemServico.findMany({
      where: { statusPagamento: 'PAGO_NA_OFICINA', pagoEm: { gte: inicioMes } },
      select: {
        id: true,
        oficinaId: true,
        mecanicoId: true,
        pagoEm: true,
        concluidoEm: true,
        descontoTipo: true,
        descontoValor: true,
        descontoStatus: true,
        itens: { where: { deletedAt: null } },
      },
    })) as unknown as (OsParaIndicador & { oficinaId: string })[];
    const porOficina = new Map<string, { faturamentoCentavos: number; ordens: number }>();
    for (const os of pagas) {
      const x = porOficina.get(os.oficinaId) ?? { faturamentoCentavos: 0, ordens: 0 };
      x.faturamentoCentavos += valorDaOs(os).totalCentavos;
      x.ordens++;
      porOficina.set(os.oficinaId, x);
    }
    const top = [...porOficina.entries()]
      .sort((a, b) => b[1].faturamentoCentavos - a[1].faturamentoCentavos)
      .slice(0, 10);
    const nomes = new Map(
      (
        await db.oficina.findMany({
          where: { id: { in: top.map(([id]) => id) } },
          select: { id: true, nome: true },
        })
      ).map((o) => [o.id, o.nome]),
    );
    return {
      // Assinaturas ativas (preço fundador quando houver). Pagamento online: em breve.
      faturamentoMensalCentavos: ativas.reduce((s, o) => s + mensalidade(o), 0),
      assinaturasAtivas: ativas.length,
      rankingFaturamentoOficinas: top.map(([oficinaId, v]) => ({
        oficinaId,
        nome: nomes.get(oficinaId) ?? '—',
        ...v,
      })),
    };
  }

  /** Saúde do sistema: banco, storage e processo. */
  async saude() {
    const medir = async (fn: () => Promise<unknown>) => {
      const t = Date.now();
      try {
        await fn();
        return { status: 'up' as const, latenciaMs: Date.now() - t };
      } catch (erro) {
        return {
          status: 'down' as const,
          latenciaMs: Date.now() - t,
          erro: (erro as Error).message.slice(0, 200),
        };
      }
    };
    const s3 = new S3Client({
      endpoint: this.config.getOrThrow<string>('S3_ENDPOINT'),
      region: this.config.get<string>('S3_REGION') ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('S3_SECRET_KEY'),
      },
    });
    const [banco, storage] = await Promise.all([
      medir(() => this.prisma.$queryRaw`SELECT 1`),
      medir(() =>
        s3.send(new HeadBucketCommand({ Bucket: this.config.getOrThrow<string>('S3_BUCKET') })),
      ),
    ]);
    const mem = process.memoryUsage();
    return {
      status: banco.status === 'up' && storage.status === 'up' ? 'ok' : 'degradado',
      servicos: { banco, storage },
      processo: {
        node: process.version,
        uptimeSegundos: Math.round((Date.now() - this.inicio) / 1000),
        memoriaMb: Math.round(mem.rss / 1024 / 1024),
        ambiente: this.config.get<string>('NODE_ENV'),
      },
      verificadoEm: new Date().toISOString(),
    };
  }
}
