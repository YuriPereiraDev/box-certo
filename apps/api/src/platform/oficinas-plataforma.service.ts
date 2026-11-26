import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SenhaService } from '../auth/senha.service.js';
import type { AtorPlataforma } from '../common/contexto/contexto.js';
import { dataLocal, localParaUtc } from '../common/utils/datas.js';
import { ROLES_QUE_CONTAM } from '../common/utils/plano.service.js';
import { cardsDeFaturamento, type OsParaIndicador } from '../dashboards/agregacoes.js';
import { criarCategoriasPadrao } from '../despesas/categorias-padrao.js';
import type { Prisma } from '../generated/prisma/client.js';
import { DIAS_TESTE, HORARIOS_PADRAO } from '../oficinas/oficinas.service.js';
import { BancoService } from '../prisma/banco.service.js';
import type {
  CriarOficinaPlataformaDto,
  FiltroOficinasDto,
  StatusOficinaDto,
} from './plataforma.dto.js';
import { gerarSenhaTemporaria, podeVerValores } from './regras.js';

const SELECAO_LISTA = {
  id: true,
  nome: true,
  documento: true,
  email: true,
  telefone: true,
  cidade: true,
  uf: true,
  status: true,
  testeAte: true,
  statusAlteradoEm: true,
  motivoStatus: true,
  precoFundadorCentavos: true,
  createdAt: true,
  plano: { select: { id: true, nome: true, maxMecanicos: true, precoCentavos: true } },
  _count: { select: { usuarios: true, clientes: true } },
} as const satisfies Prisma.OficinaSelect;

type OficinaLista = Prisma.OficinaGetPayload<{ select: typeof SELECAO_LISTA }>;

/** Mensalidade efetiva: preço fundador (se houver) ou o preço do plano. */
export function mensalidade(o: {
  precoFundadorCentavos: number | null;
  plano: { precoCentavos: number };
}) {
  return o.precoFundadorCentavos ?? o.plano.precoCentavos;
}

/** Remove os valores para quem não tem FINANCEIRO. */
function apresentar(o: OficinaLista, verValores: boolean) {
  const { precoFundadorCentavos, plano, _count, ...resto } = o;
  const { precoCentavos, ...planoSemPreco } = plano;
  return {
    ...resto,
    usuarios: _count.usuarios,
    clientes: _count.clientes,
    plano: verValores ? plano : planoSemPreco,
    ...(verValores
      ? {
          precoFundadorCentavos,
          mensalidadeCentavos: mensalidade({ precoFundadorCentavos, plano: { precoCentavos } }),
        }
      : {}),
  };
}

/** Gestão das oficinas pela plataforma (GESTAO_OFICINAS para alterar; valores só com FINANCEIRO). */
@Injectable()
export class OficinasPlataformaService {
  constructor(
    private readonly banco: BancoService,
    private readonly senhas: SenhaService,
  ) {}

  async listar(admin: AtorPlataforma, f: FiltroOficinasDto) {
    const termo = f.q?.trim();
    const where: Prisma.OficinaWhereInput = {
      deletedAt: null,
      status: f.status,
      planoId: f.planoId,
      ...(termo
        ? {
            OR: ['nome', 'documento', 'email', 'cidade'].map((campo) => ({
              [campo]: { contains: termo, mode: 'insensitive' },
            })),
          }
        : {}),
    };
    const [itens, total] = await Promise.all([
      this.banco.sistema.oficina.findMany({
        where,
        select: SELECAO_LISTA,
        orderBy: { createdAt: 'desc' },
        skip: (f.pagina - 1) * f.limite,
        take: f.limite,
      }),
      this.banco.sistema.oficina.count({ where }),
    ]);
    const verValores = podeVerValores(admin);
    return {
      itens: itens.map((o) => apresentar(o, verValores)),
      total,
      pagina: f.pagina,
      limite: f.limite,
    };
  }

  private async buscar(id: string) {
    const oficina = await this.banco.sistema.oficina.findFirst({
      where: { id, deletedAt: null },
      select: SELECAO_LISTA,
    });
    if (!oficina) throw new NotFoundException('Oficina não encontrada');
    return oficina;
  }

  async detalhar(admin: AtorPlataforma, id: string) {
    const oficina = await this.buscar(id);
    const hoje = dataLocal(new Date());
    const inicioMes = localParaUtc(`${hoje.slice(0, 7)}-01`, 0);
    const [master, mecanicosAtivos, osTotal, osMes, ultimaAtividade] = await Promise.all([
      this.banco.sistema.user.findFirst({
        where: { oficinaId: id, role: 'MASTER' },
        select: { id: true, nome: true, email: true, telefone: true, ativo: true },
      }),
      this.banco.sistema.user.count({
        where: { oficinaId: id, ativo: true, role: { in: [...ROLES_QUE_CONTAM] } },
      }),
      this.banco.sistema.ordemServico.count({ where: { oficinaId: id } }),
      this.banco.sistema.ordemServico.count({
        where: { oficinaId: id, createdAt: { gte: inicioMes } },
      }),
      this.banco.sistema.auditLog.findFirst({
        where: { oficinaId: id, atorTipo: 'USUARIO' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    const verValores = podeVerValores(admin);
    let faturamentoMesCentavos: number | undefined;
    if (verValores) {
      const pagas = (await this.banco.sistema.ordemServico.findMany({
        where: { oficinaId: id, statusPagamento: 'PAGO_NA_OFICINA', pagoEm: { gte: inicioMes } },
        select: {
          id: true,
          mecanicoId: true,
          pagoEm: true,
          concluidoEm: true,
          descontoTipo: true,
          descontoValor: true,
          descontoStatus: true,
          itens: { where: { deletedAt: null } },
        },
      })) as unknown as OsParaIndicador[];
      faturamentoMesCentavos = cardsDeFaturamento(pagas).faturamentoCentavos;
    }
    return {
      ...apresentar(oficina, verValores),
      master,
      mecanicosAtivos,
      ordensServico: { total: osTotal, noMes: osMes },
      ultimaAtividadeEm: ultimaAtividade?.createdAt ?? null,
      ...(verValores ? { faturamentoMesCentavos } : {}),
    };
  }

  /** Cria a oficina pela plataforma: TESTE por 14 dias, master com senha temporária. */
  async criar(admin: AtorPlataforma, dto: CriarOficinaPlataformaDto) {
    const plano = await this.banco.sistema.plano.findFirst({
      where: { id: dto.planoId, ativo: true },
    });
    if (!plano) throw new BadRequestException('Plano inválido');
    const senhaTemporaria = gerarSenhaTemporaria();
    const senhaHash = await this.senhas.gerarHash(senhaTemporaria);
    const oficinaId = await this.banco.sistema.$transaction(async (tx) => {
      const oficina = await tx.oficina.create({
        data: {
          ...dto.oficina,
          planoId: plano.id,
          status: 'TESTE',
          testeAte: new Date(Date.now() + DIAS_TESTE * 86_400_000),
          motivoStatus: `Criada pela plataforma (${admin.nome})`,
        },
      });
      await tx.user.create({
        data: { ...dto.master, oficinaId: oficina.id, senhaHash, role: 'MASTER', permissoes: [] },
      });
      await tx.horarioFuncionamento.createMany({
        data: HORARIOS_PADRAO.map((h) => ({ ...h, oficinaId: oficina.id })),
      });
      await criarCategoriasPadrao(tx, oficina.id);
      return oficina.id;
    });
    return {
      oficina: await this.detalhar(admin, oficinaId),
      senhaTemporariaMaster: senhaTemporaria,
    };
  }

  /** Suspende, cancela ou reativa (ATIVA). Dados nunca são apagados. */
  async alterarStatus(admin: AtorPlataforma, id: string, dto: StatusOficinaDto) {
    const atual = await this.buscar(id);
    if (atual.status === dto.status) {
      throw new UnprocessableEntityException({
        codigo: 'SEM_MUDANCA',
        mensagem: `A oficina já está ${dto.status}`,
      });
    }
    const agora = new Date();
    await this.banco.sistema.oficina.update({
      where: { id },
      data: {
        status: dto.status,
        statusAlteradoEm: agora,
        motivoStatus: dto.motivo,
        canceladaEm: dto.status === 'CANCELADA' ? agora : null,
      },
    });
    return this.detalhar(admin, id);
  }

  /** Troca de plano respeitando o limite de mecânicos ativos do plano novo. */
  async trocarPlano(admin: AtorPlataforma, id: string, planoId: string) {
    await this.buscar(id);
    const plano = await this.banco.sistema.plano.findFirst({ where: { id: planoId, ativo: true } });
    if (!plano) throw new BadRequestException('Plano inválido');
    if (plano.maxMecanicos !== null) {
      const ativos = await this.banco.sistema.user.count({
        where: { oficinaId: id, ativo: true, role: { in: [...ROLES_QUE_CONTAM] } },
      });
      if (ativos > plano.maxMecanicos) {
        throw new UnprocessableEntityException({
          codigo: 'LIMITE_DO_PLANO',
          mensagem: `A oficina tem ${ativos} mecânicos ativos e o plano ${plano.nome} permite ${plano.maxMecanicos}. Desative alguém antes.`,
          ativos,
          limite: plano.maxMecanicos,
        });
      }
    }
    await this.banco.sistema.oficina.update({ where: { id }, data: { planoId } });
    return this.detalhar(admin, id);
  }

  async estenderTeste(admin: AtorPlataforma, id: string, dias: number) {
    const oficina = await this.banco.sistema.oficina.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
    if (oficina.status !== 'TESTE') {
      throw new UnprocessableEntityException({
        codigo: 'NAO_ESTA_EM_TESTE',
        mensagem: 'A oficina não está em teste',
      });
    }
    const base = Math.max(oficina.testeAte?.getTime() ?? 0, Date.now());
    await this.banco.sistema.oficina.update({
      where: { id },
      data: { testeAte: new Date(base + dias * 86_400_000) },
    });
    return this.detalhar(admin, id);
  }

  async definirPrecoFundador(admin: AtorPlataforma, id: string, preco: number | null) {
    await this.buscar(id);
    await this.banco.sistema.oficina.update({
      where: { id },
      data: { precoFundadorCentavos: preco },
    });
    return this.detalhar(admin, id);
  }

  /**
   * Exportação dos dados da oficina (LGPD). Nunca inclui senhas, segredos nem logs.
   * Arquivos vão como metadados (as imagens ficam no storage).
   */
  async exportar(id: string) {
    const oficina = await this.banco.sistema.oficina.findFirst({ where: { id, deletedAt: null } });
    if (!oficina) throw new NotFoundException('Oficina não encontrada');
    const w = { where: { oficinaId: id } };
    const db = this.banco.sistema;
    const [
      usuarios,
      horarios,
      vinculos,
      veiculos,
      convites,
      tabelaPrecos,
      agendamentos,
      ordensServico,
      estoque,
      movimentosEstoque,
      categoriasDespesa,
      despesas,
      despesasRecorrentes,
      arquivos,
    ] = await Promise.all([
      db.user.findMany({ ...w, omit: { senhaHash: true } }),
      db.horarioFuncionamento.findMany(w),
      db.clienteOficina.findMany({
        ...w,
        include: { cliente: { omit: { senhaHash: true } } },
      }),
      db.veiculoOficina.findMany({ ...w, include: { veiculo: true } }),
      db.convite.findMany(w),
      db.itemTabelaPreco.findMany(w),
      db.agendamento.findMany(w),
      db.ordemServico.findMany({ ...w, include: { itens: true } }),
      db.estoqueItem.findMany(w),
      db.movimentoEstoque.findMany(w),
      db.categoriaDespesa.findMany(w),
      db.despesa.findMany(w),
      db.despesaRecorrente.findMany(w),
      db.arquivo.findMany({ ...w, omit: { chave: true } }),
    ]);
    return {
      geradoEm: new Date().toISOString(),
      oficina,
      usuarios,
      horarios,
      clientes: vinculos,
      veiculos,
      convites,
      tabelaPrecos,
      agendamentos,
      ordensServico,
      estoque,
      movimentosEstoque,
      categoriasDespesa,
      despesas,
      despesasRecorrentes,
      arquivos,
    };
  }
}
