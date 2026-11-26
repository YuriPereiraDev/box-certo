import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ArquivosService } from '../arquivos/arquivos.service.js';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import { dataLocal, localParaUtc, somarDias } from '../common/utils/datas.js';
import { Prisma, type SubtipoSalario } from '../generated/prisma/client.js';
import { BancoService } from '../prisma/banco.service.js';
import type {
  AtualizarCategoriaDto,
  AtualizarDespesaDto,
  CategoriaDto,
  CriarDespesaDto,
  FiltroDespesasDto,
  PagarDespesaDto,
} from './despesas.dto.js';
import { filtroSalarios, podeVerSalarios } from './regras.js';

export const ENTIDADE_COMPROVANTE = 'DESPESA';
export const MAX_COMPROVANTES = 5;

export const INCLUDE_DESPESA = {
  categoria: { select: { id: true, nome: true, ehSalario: true } },
  funcionario: { select: { id: true, nome: true } },
} as const satisfies Prisma.DespesaInclude;

const inicioDeHoje = () => localParaUtc(dataLocal(new Date()), 0);

function periodo(de?: string, ate?: string): Prisma.DateTimeFilter | undefined {
  if (!de && !ate) return undefined;
  return {
    gte: de ? localParaUtc(de, 0) : undefined,
    lt: ate ? localParaUtc(somarDias(ate, 1), 0) : undefined,
  };
}

/**
 * Despesas da oficina (seção 7.6). Acesso: MASTER ou FINANCEIRO (garantido no controller).
 * Salários só com VER_SALARIOS: sem ela, despesas e categorias de salário não existem para a
 * pessoa — somem de listas e totais, e o acesso direto responde 404.
 */
@Injectable()
export class DespesasService {
  constructor(
    private readonly banco: BancoService,
    private readonly arquivos: ArquivosService,
  ) {}

  // ----------------------------------------------------------------- regras

  /** Valida categoria, funcionário e subtipo de salário; devolve a categoria. */
  async validarClassificacao(
    ator: AtorUsuario,
    categoriaId: string,
    funcionarioId?: string | null,
    subtipoSalario?: SubtipoSalario | null,
  ) {
    const categoria = await this.banco.tenant.categoriaDespesa.findFirst({
      where: { id: categoriaId, ativo: true },
    });
    if (!categoria || (categoria.ehSalario && !podeVerSalarios(ator))) {
      throw new NotFoundException('Categoria não encontrada');
    }
    if (!categoria.ehSalario && (funcionarioId || subtipoSalario)) {
      throw new BadRequestException('Funcionário e subtipo só valem na categoria de salários');
    }
    if (funcionarioId) {
      const funcionario = await this.banco.tenant.user.findFirst({
        where: { id: funcionarioId },
        select: { id: true },
      });
      if (!funcionario) throw new NotFoundException('Funcionário não encontrado');
      if (!subtipoSalario) {
        throw new BadRequestException(
          'Informe o subtipo do pagamento (salário, vale, comissão, 13º, férias, hora extra ou benefício)',
        );
      }
    }
    return categoria;
  }

  // ----------------------------------------------------------------- despesas

  async listar(ator: AtorUsuario, f: FiltroDespesasDto) {
    const where: Prisma.DespesaWhereInput = {
      deletedAt: null,
      ...filtroSalarios(ator),
      status: f.vencidas ? 'A_PAGAR' : f.status,
      categoriaId: f.categoriaId,
      funcionarioId: f.funcionarioId,
      data: periodo(f.de, f.ate),
      ...(f.vencidas ? { vencimento: { lt: inicioDeHoje() } } : {}),
    };
    const [itens, total, somas] = await Promise.all([
      this.banco.tenant.despesa.findMany({
        where,
        include: INCLUDE_DESPESA,
        orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
        skip: (f.pagina - 1) * f.limite,
        take: f.limite,
      }),
      this.banco.tenant.despesa.count({ where }),
      this.banco.tenant.despesa.groupBy({ by: ['status'], where, _sum: { valorCentavos: true } }),
    ]);
    const soma = (status: string) =>
      somas.find((s) => s.status === status)?._sum.valorCentavos ?? 0;
    return {
      itens,
      total,
      pagina: f.pagina,
      limite: f.limite,
      somas: {
        totalCentavos: soma('PAGO') + soma('A_PAGAR'),
        pagoCentavos: soma('PAGO'),
        aPagarCentavos: soma('A_PAGAR'),
      },
    };
  }

  async buscar(ator: AtorUsuario, id: string) {
    const despesa = await this.banco.tenant.despesa.findFirst({
      where: { id, deletedAt: null, ...filtroSalarios(ator) },
      include: INCLUDE_DESPESA,
    });
    if (!despesa) throw new NotFoundException('Despesa não encontrada');
    return despesa;
  }

  async detalhar(ator: AtorUsuario, id: string) {
    const despesa = await this.buscar(ator, id);
    return {
      ...despesa,
      comprovantes: await this.arquivos.listar(ator.oficinaId, ENTIDADE_COMPROVANTE, id),
    };
  }

  async criar(ator: AtorUsuario, dto: CriarDespesaDto) {
    await this.validarClassificacao(ator, dto.categoriaId, dto.funcionarioId, dto.subtipoSalario);
    const agora = new Date();
    const data = dto.data ?? agora;
    const status = dto.status ?? (dto.pagoEm ? 'PAGO' : 'A_PAGAR');
    return this.banco.tenant.despesa.create({
      data: {
        oficinaId: ator.oficinaId,
        data,
        descricao: dto.descricao,
        valorCentavos: dto.valorCentavos,
        categoriaId: dto.categoriaId,
        funcionarioId: dto.funcionarioId,
        subtipoSalario: dto.subtipoSalario,
        status,
        vencimento: dto.vencimento ?? (status === 'A_PAGAR' ? data : null),
        pagoEm: status === 'PAGO' ? (dto.pagoEm ?? agora) : null,
        formaPagamento: dto.formaPagamento,
        criadoPorId: ator.id,
      },
      include: INCLUDE_DESPESA,
    });
  }

  async atualizar(ator: AtorUsuario, id: string, dto: AtualizarDespesaDto) {
    const atual = await this.buscar(ator, id);
    const { motivo: _motivo, ...dados } = dto;
    const categoriaId = dados.categoriaId ?? atual.categoriaId;
    const funcionarioId =
      dados.funcionarioId !== undefined ? dados.funcionarioId : atual.funcionarioId;
    const subtipo =
      dados.subtipoSalario !== undefined ? dados.subtipoSalario : atual.subtipoSalario;
    const categoria = await this.validarClassificacao(ator, categoriaId, funcionarioId, subtipo);

    const status = dados.status ?? atual.status;
    return this.banco.tenant.despesa.update({
      where: { id },
      data: {
        ...dados,
        // Saindo da categoria de salários, o vínculo com funcionário cai junto.
        ...(categoria.ehSalario ? {} : { funcionarioId: null, subtipoSalario: null }),
        pagoEm: status === 'PAGO' ? (dados.pagoEm ?? atual.pagoEm ?? new Date()) : null,
      },
      include: INCLUDE_DESPESA,
    });
  }

  async pagar(ator: AtorUsuario, id: string, dto: PagarDespesaDto) {
    const atual = await this.buscar(ator, id);
    if (atual.status === 'PAGO') {
      throw new UnprocessableEntityException({
        codigo: 'JA_PAGA',
        mensagem: 'Esta despesa já está paga',
      });
    }
    return this.banco.tenant.despesa.update({
      where: { id },
      data: {
        status: 'PAGO',
        pagoEm: dto.pagoEm ?? new Date(),
        formaPagamento: dto.formaPagamento ?? atual.formaPagamento,
      },
      include: INCLUDE_DESPESA,
    });
  }

  /** Exclusão lógica com motivo. */
  async excluir(ator: AtorUsuario, id: string, motivo: string) {
    await this.buscar(ator, id);
    await this.banco.tenant.despesa.update({
      where: { id },
      data: { deletedAt: new Date(), excluidoPorId: ator.id, motivoExclusao: motivo },
    });
  }

  /** Contas a pagar que vencem até daqui a N dias (inclui as vencidas). */
  async aVencer(ator: AtorUsuario, dias: number) {
    const hoje = dataLocal(new Date());
    const inicioHoje = localParaUtc(hoje, 0);
    const itens = await this.banco.tenant.despesa.findMany({
      where: {
        deletedAt: null,
        ...filtroSalarios(ator),
        status: 'A_PAGAR',
        vencimento: { lt: localParaUtc(somarDias(hoje, dias + 1), 0) },
      },
      include: INCLUDE_DESPESA,
      orderBy: { vencimento: 'asc' },
    });
    return {
      itens: itens.map((d) => ({ ...d, vencida: !!d.vencimento && d.vencimento < inicioHoje })),
      totalCentavos: itens.reduce((s, d) => s + d.valorCentavos, 0),
    };
  }

  /** Totais do período por categoria e por situação (base dos dashboards). */
  async resumo(ator: AtorUsuario, de?: string, ate?: string) {
    const where: Prisma.DespesaWhereInput = {
      deletedAt: null,
      ...filtroSalarios(ator),
      data: periodo(de, ate),
    };
    const [porCategoria, porStatus, categorias, aVencer] = await Promise.all([
      this.banco.tenant.despesa.groupBy({
        by: ['categoriaId'],
        where,
        _sum: { valorCentavos: true },
      }),
      this.banco.tenant.despesa.groupBy({ by: ['status'], where, _sum: { valorCentavos: true } }),
      this.banco.tenant.categoriaDespesa.findMany({ select: { id: true, nome: true } }),
      this.aVencer(ator, 7),
    ]);
    const nome = new Map(categorias.map((c) => [c.id, c.nome]));
    const soma = (status: string) =>
      porStatus.find((s) => s.status === status)?._sum.valorCentavos ?? 0;
    const inicioHoje = inicioDeHoje();
    return {
      de: de ?? null,
      ate: ate ?? null,
      totalCentavos: soma('PAGO') + soma('A_PAGAR'),
      pagoCentavos: soma('PAGO'),
      aPagarCentavos: soma('A_PAGAR'),
      porCategoria: porCategoria
        .map((c) => ({
          categoriaId: c.categoriaId,
          categoria: nome.get(c.categoriaId) ?? '—',
          totalCentavos: c._sum.valorCentavos ?? 0,
        }))
        .sort((a, b) => b.totalCentavos - a.totalCentavos),
      vencidasCentavos: aVencer.itens
        .filter((d) => d.vencimento && d.vencimento < inicioHoje)
        .reduce((s, d) => s + d.valorCentavos, 0),
      aVencerEm7DiasCentavos: aVencer.totalCentavos,
    };
  }

  // ----------------------------------------------------------------- comprovantes

  async adicionarComprovante(
    ator: AtorUsuario,
    id: string,
    arquivo: Express.Multer.File | undefined,
  ) {
    await this.buscar(ator, id);
    if ((await this.arquivos.contar(ENTIDADE_COMPROVANTE, id)) >= MAX_COMPROVANTES) {
      throw new BadRequestException(`Limite de ${MAX_COMPROVANTES} comprovantes por despesa`);
    }
    const salvo = await this.arquivos.salvarDocumento(arquivo, {
      oficinaId: ator.oficinaId,
      entidade: ENTIDADE_COMPROVANTE,
      entidadeId: id,
      ator,
    });
    const lista = await this.arquivos.listar(ator.oficinaId, ENTIDADE_COMPROVANTE, id);
    return lista.find((a) => a.id === salvo.id);
  }

  async removerComprovante(ator: AtorUsuario, id: string, arquivoId: string) {
    await this.buscar(ator, id);
    await this.arquivos.remover(arquivoId, ENTIDADE_COMPROVANTE, id);
  }

  // ----------------------------------------------------------------- categorias

  listarCategorias(ator: AtorUsuario, incluirInativas = false) {
    return this.banco.tenant.categoriaDespesa.findMany({
      where: {
        ...(incluirInativas ? {} : { ativo: true }),
        ...(podeVerSalarios(ator) ? {} : { ehSalario: false }),
      },
      orderBy: [{ padrao: 'desc' }, { nome: 'asc' }],
    });
  }

  async criarCategoria(ator: AtorUsuario, dto: CategoriaDto) {
    if (dto.ehSalario && !podeVerSalarios(ator)) {
      throw new ForbiddenException('Categoria de salários exige a permissão VER_SALARIOS');
    }
    try {
      return await this.banco.tenant.categoriaDespesa.create({
        data: { oficinaId: ator.oficinaId, nome: dto.nome, ehSalario: dto.ehSalario ?? false },
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new ConflictException('Já existe uma categoria com este nome');
      }
      throw erro;
    }
  }

  /** Categorias padrão não mudam de nome nem são desativadas. */
  async atualizarCategoria(ator: AtorUsuario, id: string, dto: AtualizarCategoriaDto) {
    const categoria = await this.banco.tenant.categoriaDespesa.findFirst({ where: { id } });
    if (!categoria || (categoria.ehSalario && !podeVerSalarios(ator))) {
      throw new NotFoundException('Categoria não encontrada');
    }
    if (categoria.padrao) {
      throw new UnprocessableEntityException({
        codigo: 'CATEGORIA_PADRAO',
        mensagem: 'Categorias padrão não podem ser renomeadas nem desativadas',
      });
    }
    return this.banco.tenant.categoriaDespesa.update({ where: { id }, data: dto });
  }
}
