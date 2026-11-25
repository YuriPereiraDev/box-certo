import { randomInt } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import QRCode from 'qrcode';
import { AuthService, type RespostaLogin } from '../auth/auth.service.js';
import { SenhaService } from '../auth/senha.service.js';
import { contextoAtual, exigirOficinaId, type AtorUsuario } from '../common/contexto/contexto.js';
import { Prisma, type Convite } from '../generated/prisma/client.js';
import { BancoService, type ClienteSistema } from '../prisma/banco.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CadastroClienteDto, CriarConviteDto, VincularClienteDto } from './convites.dto.js';

/** Cliente de transação do banco sistema. */
type TransacaoSistema = Parameters<Parameters<ClienteSistema['$transaction']>[0]>[0];

/** Sem caracteres ambíguos (0/O, 1/I/L). */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TAMANHO_CODIGO = 6;
const DIAS_CONVITE_INDIVIDUAL = 7;

export function gerarCodigoConvite(): string {
  return Array.from({ length: TAMANHO_CODIGO }, () => ALFABETO[randomInt(ALFABETO.length)]).join(
    '',
  );
}

type MotivoInvalido = 'CONVITE_INATIVO' | 'CONVITE_EXPIRADO' | 'CONVITE_ESGOTADO';

const MENSAGENS: Record<MotivoInvalido, string> = {
  CONVITE_INATIVO: 'Este convite foi desativado pela oficina. Peça um novo link.',
  CONVITE_EXPIRADO: 'Este convite expirou. Peça um novo link para a oficina.',
  CONVITE_ESGOTADO: 'Este convite já foi usado. Peça um novo link para a oficina.',
};

/** Motivo pelo qual o convite não pode ser usado, ou null se está válido. */
export function motivoConviteInvalido(
  c: Pick<Convite, 'ativo' | 'expiraEm' | 'usos' | 'maxUsos'>,
  agora = new Date(),
): MotivoInvalido | null {
  if (!c.ativo) return 'CONVITE_INATIVO';
  if (c.expiraEm && c.expiraEm <= agora) return 'CONVITE_EXPIRADO';
  if (c.maxUsos !== null && c.usos >= c.maxUsos) return 'CONVITE_ESGOTADO';
  return null;
}

const SELECAO_CONVITE = {
  id: true,
  codigo: true,
  individual: true,
  nome: true,
  telefone: true,
  expiraEm: true,
  usos: true,
  maxUsos: true,
  ativo: true,
  criadoPorId: true,
  createdAt: true,
} as const;

@Injectable()
export class ConvitesService {
  private readonly appUrl: string;

  constructor(
    private readonly banco: BancoService,
    private readonly prisma: PrismaService,
    private readonly senhas: SenhaService,
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    this.appUrl = (config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  link(codigo: string): string {
    return `${this.appUrl}/convite/${codigo}`;
  }

  private comLink<T extends { codigo: string }>(c: T) {
    return { ...c, link: this.link(c.codigo), situacao: null as MotivoInvalido | null };
  }

  // ----------------------------------------------------------------- oficina

  async criar(dto: CriarConviteDto, ator: AtorUsuario) {
    const individual = dto.individual ?? false;
    const expiraEm =
      dto.expiraEm ??
      (individual ? new Date(Date.now() + DIAS_CONVITE_INDIVIDUAL * 24 * 60 * 60 * 1000) : null);
    const maxUsos = dto.maxUsos ?? (individual ? 1 : null);

    for (let tentativa = 0; tentativa < 5; tentativa++) {
      try {
        const convite = await this.banco.tenant.convite.create({
          data: {
            oficinaId: exigirOficinaId(),
            codigo: gerarCodigoConvite(),
            individual,
            nome: dto.nome,
            telefone: dto.telefone,
            expiraEm,
            maxUsos,
            criadoPorId: ator.id,
          },
          select: SELECAO_CONVITE,
        });
        return this.comLink(convite);
      } catch (erro) {
        const colisao =
          erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
        if (!colisao) throw erro;
      }
    }
    throw new ConflictException('Não foi possível gerar um código único. Tente novamente.');
  }

  async listar() {
    const convites = await this.banco.tenant.convite.findMany({
      select: SELECAO_CONVITE,
      orderBy: { createdAt: 'desc' },
    });
    return convites.map((c) => ({ ...this.comLink(c), situacao: motivoConviteInvalido(c) }));
  }

  async detalhar(id: string) {
    const convite = await this.banco.tenant.convite.findUnique({
      where: { id },
      select: SELECAO_CONVITE,
    });
    if (!convite) throw new NotFoundException('Convite não encontrado');
    return { ...this.comLink(convite), situacao: motivoConviteInvalido(convite) };
  }

  /** MASTER, GERENTE ou quem criou o convite. */
  async desativar(id: string, ator: AtorUsuario) {
    const convite = await this.detalhar(id);
    const pode =
      ator.role === 'MASTER' ||
      ator.permissoes.includes('GERENTE') ||
      convite.criadoPorId === ator.id;
    if (!pode) throw new ForbiddenException('Só o master, um gerente ou quem criou pode desativar');
    const atualizado = await this.banco.tenant.convite.update({
      where: { id },
      data: { ativo: false },
      select: SELECAO_CONVITE,
    });
    return { ...this.comLink(atualizado), situacao: motivoConviteInvalido(atualizado) };
  }

  async qrCode(id: string): Promise<Buffer> {
    const convite = await this.detalhar(id);
    return QRCode.toBuffer(convite.link, { type: 'png', width: 512, margin: 2 });
  }

  // ----------------------------------------------------------------- público

  private async buscarValido(codigo: string) {
    const convite = await this.prisma.convite.findUnique({
      where: { codigo: codigo.trim().toUpperCase() },
      include: {
        oficina: {
          select: { id: true, nome: true, cidade: true, uf: true, status: true, deletedAt: true },
        },
      },
    });
    if (!convite || convite.oficina.deletedAt) {
      throw new NotFoundException({
        codigo: 'CONVITE_NAO_ENCONTRADO',
        mensagem: 'Convite não encontrado',
      });
    }
    const motivo = motivoConviteInvalido(convite);
    if (motivo) throw new GoneException({ codigo: motivo, mensagem: MENSAGENS[motivo] });
    if (convite.oficina.status === 'SUSPENSA' || convite.oficina.status === 'CANCELADA') {
      throw new GoneException({
        codigo: 'OFICINA_INDISPONIVEL',
        mensagem: 'Esta oficina não está aceitando novos clientes no momento.',
      });
    }
    return convite;
  }

  async consultar(codigo: string) {
    const c = await this.buscarValido(codigo);
    return {
      codigo: c.codigo,
      individual: c.individual,
      nome: c.nome,
      telefone: c.telefone,
      expiraEm: c.expiraEm,
      oficina: { nome: c.oficina.nome, cidade: c.oficina.cidade, uf: c.oficina.uf },
    };
  }

  /** Cliente novo: cria a conta, consome um uso do convite e vincula à oficina. */
  async cadastrar(codigo: string, dto: CadastroClienteDto): Promise<RespostaLogin> {
    const convite = await this.buscarValido(codigo);
    const existente = await this.prisma.cliente.findFirst({
      where: { OR: [{ cpf: dto.cpf }, { email: dto.email }] },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException({
        codigo: 'CLIENTE_JA_CADASTRADO',
        mensagem:
          'Você já tem conta no Box Certo. Entre com seu e-mail ou CPF e senha para vincular esta oficina.',
      });
    }

    const { senha, aceiteLgpd: _aceite, ...dados } = dto;
    const senhaHash = await this.senhas.gerarHash(senha);

    const cliente = await this.banco.sistema.$transaction(async (tx) => {
      await this.consumirUso(tx, convite.id);
      const cliente = await tx.cliente.create({
        data: { ...dados, senhaHash, consentimentoLgpdEm: new Date() },
      });
      await tx.clienteOficina.create({
        data: { clienteId: cliente.id, oficinaId: convite.oficinaId, conviteId: convite.id },
      });
      return cliente;
    });

    this.atribuirAuditoria(cliente);
    return this.auth.concluirLogin('CLIENTE', cliente.id);
  }

  /** Cliente que já tem conta: faz login e ganha o vínculo com a nova oficina. */
  async vincular(codigo: string, dto: VincularClienteDto) {
    const convite = await this.buscarValido(codigo);
    const sessao = await this.auth.loginCliente(dto);
    const clienteId = sessao.ator.id;

    const jaVinculado = await this.prisma.clienteOficina.findUnique({
      where: { clienteId_oficinaId: { clienteId, oficinaId: convite.oficinaId } },
    });
    if (!jaVinculado) {
      this.atribuirAuditoria({ id: clienteId, nome: sessao.ator.nome, email: sessao.ator.email });
      await this.banco.sistema.$transaction(async (tx) => {
        await this.consumirUso(tx, convite.id);
        await tx.clienteOficina.create({
          data: { clienteId, oficinaId: convite.oficinaId, conviteId: convite.id },
        });
      });
    }
    return {
      ...sessao,
      vinculoCriado: !jaVinculado,
      oficina: { id: convite.oficinaId, nome: convite.oficina.nome },
    };
  }

  /** Incrementa `usos` de forma atômica; falha se o convite esgotou ou expirou no meio do caminho. */
  private async consumirUso(
    tx: Pick<TransacaoSistema, 'convite'>,
    conviteId: string,
  ): Promise<void> {
    const agora = new Date();
    const r = await tx.convite.updateMany({
      where: {
        id: conviteId,
        ativo: true,
        AND: [
          { OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] },
          { OR: [{ maxUsos: null }, { usos: { lt: this.prisma.convite.fields.maxUsos } }] },
        ],
      },
      data: { usos: { increment: 1 } },
    });
    if (r.count === 0) {
      throw new GoneException({ codigo: 'CONVITE_ESGOTADO', mensagem: MENSAGENS.CONVITE_ESGOTADO });
    }
  }

  /** Rotas públicas não têm ator: atribui a auditoria ao próprio cliente. */
  private atribuirAuditoria(cliente: { id: string; nome: string; email: string }) {
    const ctx = contextoAtual();
    if (ctx)
      ctx.ator = { tipo: 'CLIENTE', id: cliente.id, nome: cliente.nome, email: cliente.email };
  }
}
