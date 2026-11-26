import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SenhaService } from '../auth/senha.service.js';
import { TokensService } from '../auth/tokens.service.js';
import type { AtorPlataforma } from '../common/contexto/contexto.js';
import type { PermissaoPlataforma } from '../generated/prisma/client.js';
import { BancoService } from '../prisma/banco.service.js';
import type { AtualizarAdminDto, CriarAdminDto } from './plataforma.dto.js';
import { gerarSenhaTemporaria } from './regras.js';

const SELECAO_ADMIN = {
  id: true,
  nome: true,
  email: true,
  isOwner: true,
  permissoes: true,
  ativo: true,
  totpAtivadoEm: true,
  createdAt: true,
} as const;

/** Só pode conceder ou tirar permissões que tem (o dono pode todas). */
export function exigirPermissoesConcediveis(
  ator: AtorPlataforma,
  alteradas: PermissaoPlataforma[],
): void {
  if (ator.isOwner) return;
  const fora = alteradas.filter((p) => !ator.permissoes.includes(p));
  if (fora.length) {
    throw new ForbiddenException(
      `Você não pode conceder ou retirar permissões que não tem: ${fora.join(', ')}`,
    );
  }
}

/**
 * Admins da plataforma (GESTAO_ADMINS). O dono só é criado pelo seed e não pode ser
 * alterado, bloqueado nem resetado pela API. Novos admins entram sem FINANCEIRO, a menos
 * que quem cria tenha essa permissão (ou seja o dono).
 */
@Injectable()
export class AdminsService {
  constructor(
    private readonly banco: BancoService,
    private readonly senhas: SenhaService,
    private readonly tokens: TokensService,
  ) {}

  listar() {
    return this.banco.sistema.platformAdmin.findMany({
      select: SELECAO_ADMIN,
      orderBy: [{ isOwner: 'desc' }, { nome: 'asc' }],
    });
  }

  private async buscar(id: string) {
    const admin = await this.banco.sistema.platformAdmin.findUnique({
      where: { id },
      select: SELECAO_ADMIN,
    });
    if (!admin) throw new NotFoundException('Admin não encontrado');
    return admin;
  }

  /**
   * Só altera, bloqueia ou reseta quem não tem mais poder que você: o alvo não pode ter
   * permissão que você não tem (senão bastaria resetar o acesso dele para herdar a permissão).
   */
  private async alvoEditavel(ator: AtorPlataforma, id: string) {
    const alvo = await this.buscar(id);
    if (alvo.isOwner) throw new ForbiddenException('O dono não pode ser alterado por aqui');
    if (alvo.id === ator.id)
      throw new ForbiddenException('Você não pode alterar a própria conta por aqui');
    if (!ator.isOwner) {
      const aMais = alvo.permissoes.filter((p) => !ator.permissoes.includes(p));
      if (aMais.length) {
        throw new ForbiddenException(
          `Este admin tem permissões que você não tem (${aMais.join(', ')}); só o dono pode alterá-lo`,
        );
      }
    }
    return alvo;
  }

  /** Cria com senha temporária (mostrada uma vez); o 2FA é configurado no primeiro login. */
  async criar(ator: AtorPlataforma, dto: CriarAdminDto) {
    exigirPermissoesConcediveis(ator, dto.permissoes);
    const existe = await this.banco.sistema.platformAdmin.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existe) throw new ConflictException('Já existe um admin com este e-mail');
    const senhaTemporaria = gerarSenhaTemporaria();
    const admin = await this.banco.sistema.platformAdmin.create({
      data: {
        nome: dto.nome,
        email: dto.email,
        permissoes: dto.permissoes,
        senhaHash: await this.senhas.gerarHash(senhaTemporaria),
      },
      select: SELECAO_ADMIN,
    });
    return { admin, senhaTemporaria };
  }

  async atualizar(ator: AtorPlataforma, id: string, dto: AtualizarAdminDto) {
    const alvo = await this.alvoEditavel(ator, id);
    if (dto.permissoes) {
      const alteradas = [
        ...dto.permissoes.filter((p) => !alvo.permissoes.includes(p)),
        ...alvo.permissoes.filter((p) => !dto.permissoes!.includes(p)),
      ];
      exigirPermissoesConcediveis(ator, alteradas);
    }
    return this.banco.sistema.platformAdmin.update({
      where: { id },
      data: dto,
      select: SELECAO_ADMIN,
    });
  }

  async definirStatus(ator: AtorPlataforma, id: string, ativo: boolean) {
    await this.alvoEditavel(ator, id);
    const admin = await this.banco.sistema.platformAdmin.update({
      where: { id },
      data: { ativo },
      select: SELECAO_ADMIN,
    });
    if (!ativo) await this.tokens.revogarTodos('PLATAFORMA', id);
    return admin;
  }

  /** Nova senha temporária e 2FA zerado (reconfigura no próximo login); encerra as sessões. */
  async resetarAcesso(ator: AtorPlataforma, id: string) {
    await this.alvoEditavel(ator, id);
    const senhaTemporaria = gerarSenhaTemporaria();
    await this.banco.sistema.platformAdmin.update({
      where: { id },
      data: {
        senhaHash: await this.senhas.gerarHash(senhaTemporaria),
        totpSecret: null,
        totpAtivadoEm: null,
      },
    });
    await this.tokens.revogarTodos('PLATAFORMA', id);
    return { senhaTemporaria };
  }
}
