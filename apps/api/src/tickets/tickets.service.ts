import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArquivosService } from '../arquivos/arquivos.service.js';
import type {
  Ator,
  AtorCliente,
  AtorPlataforma,
  AtorUsuario,
} from '../common/contexto/contexto.js';
import type { Prisma, StatusTicket, Ticket } from '../generated/prisma/client.js';
import { BancoService } from '../prisma/banco.service.js';
import type {
  AbrirTicketDto,
  AtualizarTicketDto,
  FiltroFilaDto,
  MensagemSuporteDto,
} from './tickets.dto.js';

export const MAX_ANEXOS_TICKET = 5;

/** Quem abre ticket: usuário da oficina ou cliente (o modo suporte não abre ticket). */
export type AutorTicket = (AtorUsuario & { tipo: 'USUARIO' }) | AtorCliente;

/**
 * Quem vê o ticket do lado do usuário: quem abriu e, se foi um usuário da oficina, também o
 * master da mesma oficina (decisão da fase 9). Tickets de clientes só o próprio cliente vê.
 */
export function podeVerTicket(
  ator: AutorTicket,
  t: Pick<Ticket, 'autorTipo' | 'autorId' | 'oficinaId'>,
): boolean {
  if (t.autorTipo === ator.tipo && t.autorId === ator.id) return true;
  return (
    ator.tipo === 'USUARIO' &&
    ator.role === 'MASTER' &&
    t.autorTipo === 'USUARIO' &&
    t.oficinaId === ator.oficinaId
  );
}

/** Status depois de uma mensagem do usuário: respondido volta para análise; resolvido reabre. */
export function statusAposMensagemDoUsuario(atual: StatusTicket): StatusTicket {
  if (atual === 'RESPONDIDO') return 'EM_ANALISE';
  if (atual === 'RESOLVIDO') return 'ABERTO';
  return atual;
}

const RESUMO = {
  id: true,
  numero: true,
  tipo: true,
  titulo: true,
  status: true,
  prioridade: true,
  autorTipo: true,
  autorNome: true,
  oficinaId: true,
  atribuidoAId: true,
  primeiraRespostaEm: true,
  resolvidoEm: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TicketSelect;

/** Tickets de suporte (seção 7.7): o usuário abre e conversa; o time de suporte atende na fila. */
@Injectable()
export class TicketsService {
  constructor(
    private readonly banco: BancoService,
    private readonly arquivos: ArquivosService,
  ) {}

  // ----------------------------------------------------------------- usuário/cliente

  /** Garante que o ator é um autor válido (bloqueia o modo suporte). */
  autor(ator: Ator): AutorTicket {
    if (ator.tipo === 'CLIENTE') return ator;
    if (ator.tipo === 'USUARIO') return { ...ator, tipo: 'USUARIO' };
    throw new ForbiddenException('Tickets são abertos por usuários das oficinas e clientes');
  }

  async abrir(ator: AutorTicket, dto: AbrirTicketDto) {
    return this.banco.sistema.ticket.create({
      data: {
        oficinaId: ator.tipo === 'USUARIO' ? ator.oficinaId : null,
        autorTipo: ator.tipo,
        autorId: ator.id,
        autorNome: ator.nome,
        tipo: dto.tipo,
        titulo: dto.titulo,
        descricao: dto.descricao,
        contexto: dto.contexto ? { ...dto.contexto } : undefined,
      },
      select: RESUMO,
    });
  }

  listarMeus(ator: AutorTicket, status?: StatusTicket) {
    const meus: Prisma.TicketWhereInput = { autorTipo: ator.tipo, autorId: ator.id };
    const daOficina: Prisma.TicketWhereInput | null =
      ator.tipo === 'USUARIO' && ator.role === 'MASTER'
        ? { autorTipo: 'USUARIO', oficinaId: ator.oficinaId }
        : null;
    return this.banco.sistema.ticket.findMany({
      where: { status, OR: daOficina ? [meus, daOficina] : [meus] },
      select: RESUMO,
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async buscarParaUsuario(ator: AutorTicket, id: string) {
    const ticket = await this.banco.sistema.ticket.findUnique({ where: { id } });
    if (!ticket || !podeVerTicket(ator, ticket))
      throw new NotFoundException('Ticket não encontrado');
    return ticket;
  }

  async detalharParaUsuario(ator: AutorTicket, id: string) {
    const ticket = await this.buscarParaUsuario(ator, id);
    const [mensagens, anexos] = await Promise.all([
      this.banco.sistema.ticketMensagem.findMany({
        where: { ticketId: id, interna: false },
        select: { id: true, autorTipo: true, autorNome: true, texto: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.arquivos.listar(ticket.oficinaId, 'TICKET', id),
    ]);
    const { atribuidoAId: _a, ...publico } = ticket;
    return {
      ...publico,
      // O time de suporte aparece sempre como "Suporte Box Certo" para o usuário.
      mensagens: mensagens.map((m) =>
        m.autorTipo === 'PLATAFORMA' ? { ...m, autorNome: 'Suporte Box Certo' } : m,
      ),
      anexos,
    };
  }

  async responderComoUsuario(ator: AutorTicket, id: string, texto: string) {
    const ticket = await this.buscarParaUsuario(ator, id);
    await this.banco.sistema.$transaction(async (tx) => {
      await tx.ticketMensagem.create({
        data: { ticketId: id, autorTipo: ator.tipo, autorId: ator.id, autorNome: ator.nome, texto },
      });
      const status = statusAposMensagemDoUsuario(ticket.status);
      await tx.ticket.update({
        where: { id },
        data: { status, ...(status !== 'RESOLVIDO' ? { resolvidoEm: null } : {}) },
      });
    });
    return this.detalharParaUsuario(ator, id);
  }

  async resolverComoUsuario(ator: AutorTicket, id: string) {
    await this.buscarParaUsuario(ator, id);
    await this.banco.sistema.ticket.update({
      where: { id },
      data: { status: 'RESOLVIDO', resolvidoEm: new Date() },
    });
    return this.detalharParaUsuario(ator, id);
  }

  async anexar(ator: Ator, ticket: Ticket, arquivo: Express.Multer.File | undefined) {
    if ((await this.arquivos.contarSemOficina('TICKET', ticket.id)) >= MAX_ANEXOS_TICKET) {
      throw new BadRequestException(`Limite de ${MAX_ANEXOS_TICKET} anexos por ticket`);
    }
    const salvo = await this.arquivos.salvarAnexoTicket(arquivo, {
      oficinaId: ticket.oficinaId,
      ticketId: ticket.id,
      ator,
    });
    const lista = await this.arquivos.listar(ticket.oficinaId, 'TICKET', ticket.id);
    return lista.find((a) => a.id === salvo.id);
  }

  async anexarComoUsuario(ator: AutorTicket, id: string, arquivo: Express.Multer.File | undefined) {
    return this.anexar(ator, await this.buscarParaUsuario(ator, id), arquivo);
  }

  // ----------------------------------------------------------------- suporte (fila)

  async fila(admin: AtorPlataforma, f: FiltroFilaDto) {
    const termo = f.q?.trim();
    const numero = termo && /^\d+$/.test(termo) ? Number(termo) : undefined;
    const where: Prisma.TicketWhereInput = {
      status: f.status ?? { not: 'RESOLVIDO' },
      tipo: f.tipo,
      ...(f.meus ? { atribuidoAId: admin.id } : {}),
      ...(termo
        ? {
            OR: [
              { titulo: { contains: termo, mode: 'insensitive' } },
              { autorNome: { contains: termo, mode: 'insensitive' } },
              ...(numero !== undefined ? [{ numero }] : []),
            ],
          }
        : {}),
    };
    const [itens, total] = await Promise.all([
      this.banco.sistema.ticket.findMany({
        where,
        select: RESUMO,
        orderBy: [{ prioridade: 'desc' }, { createdAt: 'asc' }],
        skip: (f.pagina - 1) * f.limite,
        take: f.limite,
      }),
      this.banco.sistema.ticket.count({ where }),
    ]);
    return { itens, total, pagina: f.pagina, limite: f.limite };
  }

  private async buscar(id: string) {
    const ticket = await this.banco.sistema.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    return ticket;
  }

  async detalharParaSuporte(id: string) {
    const ticket = await this.buscar(id);
    const [mensagens, anexos, oficina, autor] = await Promise.all([
      this.banco.sistema.ticketMensagem.findMany({
        where: { ticketId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.arquivos.listar(ticket.oficinaId, 'TICKET', id),
      ticket.oficinaId
        ? this.banco.sistema.oficina.findUnique({
            where: { id: ticket.oficinaId },
            select: { id: true, nome: true, status: true },
          })
        : null,
      ticket.autorTipo === 'USUARIO'
        ? this.banco.sistema.user.findUnique({
            where: { id: ticket.autorId },
            select: { id: true, nome: true, email: true, telefone: true, role: true },
          })
        : this.banco.sistema.cliente.findUnique({
            where: { id: ticket.autorId },
            select: { id: true, nome: true, email: true, telefone: true },
          }),
    ]);
    return { ...ticket, oficina, autor, mensagens, anexos };
  }

  async atualizar(id: string, dto: AtualizarTicketDto) {
    const atual = await this.buscar(id);
    if (dto.atribuidoAId) {
      const admin = await this.banco.sistema.platformAdmin.findUnique({
        where: { id: dto.atribuidoAId },
        select: { ativo: true, isOwner: true, permissoes: true },
      });
      if (!admin?.ativo || !(admin.isOwner || admin.permissoes.includes('SUPORTE'))) {
        throw new BadRequestException('Atribua a um admin ativo com SUPORTE');
      }
    }
    const status = dto.status ?? atual.status;
    await this.banco.sistema.ticket.update({
      where: { id },
      data: {
        ...dto,
        resolvidoEm: status === 'RESOLVIDO' ? (atual.resolvidoEm ?? new Date()) : null,
      },
    });
    return this.detalharParaSuporte(id);
  }

  /**
   * Resposta do suporte: pública marca RESPONDIDO (e a primeira resposta, para o tempo
   * médio); nota interna não muda o status nem aparece para o usuário.
   */
  async responderComoSuporte(admin: AtorPlataforma, id: string, dto: MensagemSuporteDto) {
    const ticket = await this.buscar(id);
    const interna = dto.interna ?? false;
    const agora = new Date();
    await this.banco.sistema.$transaction(async (tx) => {
      await tx.ticketMensagem.create({
        data: {
          ticketId: id,
          autorTipo: 'PLATAFORMA',
          autorId: admin.id,
          autorNome: admin.nome,
          texto: dto.texto,
          interna,
        },
      });
      if (!interna) {
        await tx.ticket.update({
          where: { id },
          data: {
            status: 'RESPONDIDO',
            primeiraRespostaEm: ticket.primeiraRespostaEm ?? agora,
            atribuidoAId: ticket.atribuidoAId ?? admin.id,
            resolvidoEm: null,
          },
        });
      }
    });
    // Notificar o usuário (push/e-mail): fase 11.
    return this.detalharParaSuporte(id);
  }

  async anexarComoSuporte(
    admin: AtorPlataforma,
    id: string,
    arquivo: Express.Multer.File | undefined,
  ) {
    return this.anexar(admin, await this.buscar(id), arquivo);
  }

  /** Indicadores para o dashboard da plataforma (últimos 30 dias). */
  async indicadores() {
    const desde = new Date(Date.now() - 30 * 86_400_000);
    const [porStatus, respondidos, erros] = await Promise.all([
      this.banco.sistema.ticket.groupBy({ by: ['status'], _count: true }),
      this.banco.sistema.ticket.findMany({
        where: { primeiraRespostaEm: { gte: desde } },
        select: { createdAt: true, primeiraRespostaEm: true },
      }),
      this.banco.sistema.ticket.findMany({
        where: { tipo: 'ERRO', createdAt: { gte: desde } },
        select: { contexto: true },
      }),
    ]);
    const status = { ABERTO: 0, EM_ANALISE: 0, RESPONDIDO: 0, RESOLVIDO: 0 };
    for (const s of porStatus) status[s.status] = s._count;
    const tempos = respondidos.map((t) => t.primeiraRespostaEm!.getTime() - t.createdAt.getTime());
    const porTela = new Map<string, number>();
    for (const e of erros) {
      const rota = (e.contexto as { rota?: string } | null)?.rota ?? '(tela não informada)';
      porTela.set(rota, (porTela.get(rota) ?? 0) + 1);
    }
    return {
      abertos: status.ABERTO + status.EM_ANALISE + status.RESPONDIDO,
      porStatus: status,
      tempoMedioPrimeiraRespostaMin: tempos.length
        ? Math.round(tempos.reduce((s, t) => s + t, 0) / tempos.length / 60_000)
        : null,
      errosMaisReportados: [...porTela.entries()]
        .map(([rota, quantidade]) => ({ rota, quantidade }))
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, 10),
    };
  }
}
