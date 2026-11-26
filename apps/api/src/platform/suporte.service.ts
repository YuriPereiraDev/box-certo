import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TokensService } from '../auth/tokens.service.js';
import type { AtorPlataforma } from '../common/contexto/contexto.js';
import { BancoService } from '../prisma/banco.service.js';
import type { AbrirSuporteDto } from './plataforma.dto.js';

export const DURACAO_PADRAO_SUPORTE_MIN = 60;

/**
 * Modo suporte (seção 9): o admin com SUPORTE abre uma sessão com motivo, por tempo limitado,
 * e recebe um token para usar as rotas /oficina/* como MASTER daquela oficina (leitura e
 * escrita — decisão da fase 8). Tudo fica registrado com atorTipo = SUPORTE e aparece nos
 * logs da oficina como "Suporte Box Certo". Sem refresh: acabou o tempo, abre outra sessão.
 */
@Injectable()
export class SuporteService {
  constructor(
    private readonly banco: BancoService,
    private readonly tokens: TokensService,
  ) {}

  async abrir(admin: AtorPlataforma, dto: AbrirSuporteDto) {
    const oficina = await this.banco.sistema.oficina.findFirst({
      where: { id: dto.oficinaId, deletedAt: null },
      select: { id: true, nome: true, status: true },
    });
    if (!oficina) throw new NotFoundException('Oficina não encontrada');
    const expiraEm = new Date(Date.now() + (dto.duracaoMin ?? DURACAO_PADRAO_SUPORTE_MIN) * 60_000);
    const sessao = await this.banco.sistema.sessaoSuporte.create({
      data: { adminId: admin.id, oficinaId: oficina.id, motivo: dto.motivo, expiraEm },
    });
    return {
      sessaoId: sessao.id,
      oficina,
      expiraEm,
      accessToken: await this.tokens.emitirSuporte(admin.id, oficina.id, sessao.id, expiraEm),
    };
  }

  /** O próprio admin (ou o dono) encerra a sessão antes do prazo. */
  async encerrar(admin: AtorPlataforma, id: string) {
    const sessao = await this.banco.sistema.sessaoSuporte.findUnique({ where: { id } });
    if (!sessao) throw new NotFoundException('Sessão não encontrada');
    if (sessao.adminId !== admin.id && !admin.isOwner) {
      throw new ForbiddenException('Só quem abriu a sessão (ou o dono) pode encerrá-la');
    }
    if (sessao.encerradaEm || sessao.expiraEm <= new Date()) {
      throw new UnprocessableEntityException({
        codigo: 'SESSAO_ENCERRADA',
        mensagem: 'A sessão já terminou',
      });
    }
    return this.banco.sistema.sessaoSuporte.update({
      where: { id },
      data: { encerradaEm: new Date() },
    });
  }

  /** Sessões abertas agora (todas, para o time de suporte saber quem está em qual oficina). */
  ativas() {
    return this.banco.sistema.sessaoSuporte.findMany({
      where: { encerradaEm: null, expiraEm: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
