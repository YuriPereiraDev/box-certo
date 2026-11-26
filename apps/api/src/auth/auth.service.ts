import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditoriaService, type EntradaAuditoria } from '../auditoria/auditoria.service.js';
import { CriptografiaService } from '../common/cripto/criptografia.service.js';
import { contextoAtual, type Ator, type TipoAtorAutenticado } from '../common/contexto/contexto.js';
import { somenteDigitos } from '../common/utils/cpf.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AtoresService } from './atores.service.js';
import type { LoginClienteDto, LoginOficinaDto, LoginPlataformaDto } from './dto.js';
import { SenhaService } from './senha.service.js';
import { TokensService, type ParDeTokens } from './tokens.service.js';
import { TotpService } from './totp.service.js';

export interface RespostaLogin extends ParDeTokens {
  ator: Ator;
}

export interface RespostaConfig2faPendente {
  requerConfiguracao2fa: true;
  tokenConfiguracao: string;
}

const ENTIDADE_DO_ATOR: Record<TipoAtorAutenticado, string> = {
  PLATAFORMA: 'PlatformAdmin',
  USUARIO: 'User',
  CLIENTE: 'Cliente',
  SUPORTE: 'SessaoSuporte',
};

const JANELA_BLOQUEIO_MS = 15 * 60_000;

const CREDENCIAIS_INVALIDAS = 'E-mail ou senha inválidos';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly senhas: SenhaService,
    private readonly tokens: TokensService,
    private readonly atores: AtoresService,
    private readonly totp: TotpService,
    private readonly cripto: CriptografiaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ---------------------------------------------------------------- oficina

  async loginOficina(dto: LoginOficinaDto): Promise<RespostaLogin> {
    const email = dto.email.trim().toLowerCase();
    const candidatos = await this.prisma.user.findMany({
      where: {
        email,
        ativo: true,
        oficina: { deletedAt: null },
        ...(dto.oficinaId ? { oficinaId: dto.oficinaId } : {}),
      },
      include: { oficina: { select: { id: true, nome: true, status: true } } },
    });

    await this.exigirContaLiberada(
      'USUARIO',
      candidatos.map((c) => c.id),
      email,
    );
    const validos = [];
    for (const c of candidatos) {
      if (await this.senhas.verificar(c.senhaHash, dto.senha)) validos.push(c);
    }
    if (candidatos.length === 0) await this.senhas.verificar(null, dto.senha);

    if (validos.length === 0) {
      await this.registrar({
        acao: 'LOGIN_FALHA',
        entidade: 'User',
        atorTipo: 'USUARIO',
        atorId: candidatos.length === 1 ? candidatos[0].id : null,
        oficinaId: candidatos.length === 1 ? candidatos[0].oficinaId : null,
        depois: { email },
      });
      throw new UnauthorizedException(CREDENCIAIS_INVALIDAS);
    }
    if (validos.length > 1) {
      throw new ConflictException({
        codigo: 'ESCOLHA_OFICINA',
        mensagem: 'Este e-mail está em mais de uma oficina. Escolha em qual entrar.',
        oficinas: validos.map((v) => ({ id: v.oficina.id, nome: v.oficina.nome })),
      });
    }

    const user = validos[0];
    try {
      this.atores.verificarStatusOficina(user.oficina.status);
    } catch (erro) {
      await this.registrar({
        acao: 'LOGIN_BLOQUEADO_OFICINA',
        entidade: 'User',
        entidadeId: user.id,
        atorTipo: 'USUARIO',
        atorId: user.id,
        atorNome: user.nome,
        oficinaId: user.oficinaId,
        depois: { status: user.oficina.status },
      });
      throw erro;
    }
    return this.concluirLogin('USUARIO', user.id, user.oficinaId);
  }

  // ---------------------------------------------------------------- cliente

  async loginCliente(dto: LoginClienteDto): Promise<RespostaLogin> {
    const login = dto.login.trim().toLowerCase();
    const cpf = somenteDigitos(login);
    const ehCpf = !login.includes('@') && cpf.length === 11;
    const cliente = await this.prisma.cliente.findUnique({
      where: ehCpf ? { cpf } : { email: login },
    });

    if (cliente) await this.exigirContaLiberada('CLIENTE', [cliente.id]);
    const ok = await this.senhas.verificar(cliente?.ativo ? cliente.senhaHash : null, dto.senha);
    if (!cliente?.ativo || !ok) {
      await this.registrar({
        acao: 'LOGIN_FALHA',
        entidade: 'Cliente',
        atorTipo: 'CLIENTE',
        atorId: cliente?.id ?? null,
        depois: { login: ehCpf ? `***${cpf.slice(-4)}` : login },
      });
      throw new UnauthorizedException('Login ou senha inválidos');
    }
    return this.concluirLogin('CLIENTE', cliente.id);
  }

  // ------------------------------------------------------------- plataforma

  async loginPlataforma(
    dto: LoginPlataformaDto,
  ): Promise<RespostaLogin | RespostaConfig2faPendente> {
    const email = dto.email.trim().toLowerCase();
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email } });
    if (admin) await this.exigirContaLiberada('PLATAFORMA', [admin.id], email);
    const ok = await this.senhas.verificar(admin?.ativo ? admin.senhaHash : null, dto.senha);

    if (!admin?.ativo || !ok) {
      await this.registrar({
        acao: 'LOGIN_FALHA',
        entidade: 'PlatformAdmin',
        atorTipo: 'PLATAFORMA',
        atorId: admin?.id ?? null,
        depois: { email },
      });
      throw new UnauthorizedException(CREDENCIAIS_INVALIDAS);
    }

    // 2FA obrigatório: sem 2FA ativo, o admin só recebe um token para configurá-lo.
    if (!admin.totpAtivadoEm || !admin.totpSecret) {
      return {
        requerConfiguracao2fa: true,
        tokenConfiguracao: await this.tokens.emitirConfig2fa(admin.id),
      };
    }

    if (!dto.codigoTotp) {
      throw new UnauthorizedException({
        codigo: 'TOTP_OBRIGATORIO',
        mensagem: 'Informe o código do app autenticador',
      });
    }
    const passo = this.totp.passoValido(
      this.cripto.descriptografar(admin.totpSecret),
      dto.codigoTotp,
    );
    if (passo === null || !(await this.consumirPassoTotp(admin.id, passo))) {
      await this.registrar({
        acao: 'LOGIN_FALHA_2FA',
        entidade: 'PlatformAdmin',
        entidadeId: admin.id,
        atorTipo: 'PLATAFORMA',
        atorId: admin.id,
        atorNome: admin.nome,
      });
      throw new UnauthorizedException({ codigo: 'TOTP_INVALIDO', mensagem: 'Código inválido' });
    }
    return this.concluirLogin('PLATAFORMA', admin.id);
  }

  /** Gera (ou regera) o segredo TOTP enquanto o 2FA ainda não foi ativado. */
  async configurar2fa(tokenConfiguracao: string) {
    const { sub } = await this.tokens.verificarConfig2fa(tokenConfiguracao);
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: sub } });
    if (!admin?.ativo || admin.totpAtivadoEm) throw new UnauthorizedException('Token inválido');

    const segredo = this.totp.gerarSegredo();
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { totpSecret: this.cripto.criptografar(segredo) },
    });
    await this.registrar({
      acao: '2FA_CONFIGURACAO_INICIADA',
      entidade: 'PlatformAdmin',
      entidadeId: admin.id,
      atorTipo: 'PLATAFORMA',
      atorId: admin.id,
      atorNome: admin.nome,
    });
    return { segredo, otpauthUrl: this.totp.urlOtpAuth(segredo, admin.email) };
  }

  async ativar2fa(tokenConfiguracao: string, codigo: string): Promise<RespostaLogin> {
    const { sub } = await this.tokens.verificarConfig2fa(tokenConfiguracao);
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: sub } });
    if (!admin?.ativo || admin.totpAtivadoEm || !admin.totpSecret) {
      throw new UnauthorizedException('Token inválido');
    }
    const passo = this.totp.passoValido(this.cripto.descriptografar(admin.totpSecret), codigo);
    if (passo === null || !(await this.consumirPassoTotp(admin.id, passo))) {
      throw new UnauthorizedException({ codigo: 'TOTP_INVALIDO', mensagem: 'Código inválido' });
    }
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { totpAtivadoEm: new Date() },
    });
    await this.registrar({
      acao: '2FA_ATIVADO',
      entidade: 'PlatformAdmin',
      entidadeId: admin.id,
      atorTipo: 'PLATAFORMA',
      atorId: admin.id,
      atorNome: admin.nome,
    });
    return this.concluirLogin('PLATAFORMA', admin.id);
  }

  // ---------------------------------------------------------------- sessão

  /** Refresh rotativo: cada refresh token vale uma vez. Reuso revoga todas as sessões do ator. */
  async refresh(refreshToken: string): Promise<RespostaLogin> {
    const registro = await this.prisma.refreshToken.findUnique({
      where: { hash: this.tokens.hashRefresh(refreshToken) },
    });
    if (!registro || registro.expiraEm < new Date()) {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }

    const revogado = await this.prisma.refreshToken.updateMany({
      where: { id: registro.id, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
    if (revogado.count === 0) {
      await this.prisma.refreshToken.updateMany({
        where: { atorTipo: registro.atorTipo, atorId: registro.atorId, revogadoEm: null },
        data: { revogadoEm: new Date() },
      });
      await this.registrar({
        acao: 'REFRESH_TOKEN_REUTILIZADO',
        entidade: 'RefreshToken',
        entidadeId: registro.id,
        atorTipo: registro.atorTipo,
        atorId: registro.atorId,
        motivo: 'Refresh token já usado foi apresentado de novo; todas as sessões foram revogadas',
      });
      throw new UnauthorizedException('Sessão inválida. Faça login novamente.');
    }

    const tipo = registro.atorTipo as TipoAtorAutenticado;
    const ator = await this.atores.carregar(tipo, registro.atorId);
    const { par, refreshId } = await this.tokens.emitirPar(
      { tipo, id: ator.id, oficinaId: ator.tipo === 'USUARIO' ? ator.oficinaId : undefined },
      this.infoCliente(),
    );
    await this.prisma.refreshToken.update({
      where: { id: registro.id },
      data: { substituidoPor: refreshId },
    });
    return { ...par, ator };
  }

  async logout(refreshToken: string): Promise<void> {
    const registro = await this.prisma.refreshToken.findUnique({
      where: { hash: this.tokens.hashRefresh(refreshToken) },
    });
    if (!registro) return;
    await this.prisma.refreshToken.updateMany({
      where: { id: registro.id, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
    await this.registrar({
      acao: 'LOGOUT',
      entidade: 'RefreshToken',
      entidadeId: registro.id,
      atorTipo: registro.atorTipo,
      atorId: registro.atorId,
    });
  }

  /** Troca a própria senha; encerra as outras sessões e devolve um par novo. */
  async trocarSenha(ator: Ator, senhaAtual: string, novaSenha: string): Promise<RespostaLogin> {
    if (ator.tipo === 'SUPORTE') {
      throw new ForbiddenException('No modo suporte não é possível trocar senha');
    }
    const conta =
      ator.tipo === 'PLATAFORMA'
        ? await this.prisma.platformAdmin.findUnique({ where: { id: ator.id } })
        : ator.tipo === 'USUARIO'
          ? await this.prisma.user.findUnique({ where: { id: ator.id } })
          : await this.prisma.cliente.findUnique({ where: { id: ator.id } });
    if (!conta || !(await this.senhas.verificar(conta.senhaHash, senhaAtual))) {
      throw new UnauthorizedException('Senha atual incorreta');
    }
    const senhaHash = await this.senhas.gerarHash(novaSenha);
    if (ator.tipo === 'PLATAFORMA') {
      await this.prisma.platformAdmin.update({ where: { id: ator.id }, data: { senhaHash } });
    } else if (ator.tipo === 'USUARIO') {
      await this.prisma.user.update({ where: { id: ator.id }, data: { senhaHash } });
    } else {
      await this.prisma.cliente.update({ where: { id: ator.id }, data: { senhaHash } });
    }
    await this.tokens.revogarTodos(ator.tipo, ator.id);
    await this.registrar({
      acao: 'SENHA_ALTERADA',
      entidade: ENTIDADE_DO_ATOR[ator.tipo],
      entidadeId: ator.id,
      atorTipo: ator.tipo,
      atorId: ator.id,
      atorNome: ator.nome,
      oficinaId: ator.tipo === 'USUARIO' ? ator.oficinaId : null,
    });
    return this.concluirLogin(
      ator.tipo,
      ator.id,
      ator.tipo === 'USUARIO' ? ator.oficinaId : undefined,
    );
  }

  // --------------------------------------------------------------- interno

  /**
   * Bloqueio por conta (além do limite por IP): N falhas em 15 min, contadas desde o último
   * login bem-sucedido, bloqueiam a conta por 15 min mesmo vindo de IPs diferentes.
   */
  private async exigirContaLiberada(atorTipo: TipoAtorAutenticado, ids: string[], email?: string) {
    if (ids.length === 0 && !email) return;
    const max = Number(process.env.LOGIN_MAX_FALHAS_CONTA ?? 10);
    const janela = new Date(Date.now() - JANELA_BLOQUEIO_MS);
    const ultimoSucesso = ids.length
      ? await this.prisma.auditLog.findFirst({
          where: {
            acao: 'LOGIN_SUCESSO',
            atorTipo,
            atorId: { in: ids },
            createdAt: { gt: janela },
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
      : null;
    const falhas = await this.prisma.auditLog.count({
      where: {
        atorTipo,
        acao: { in: ['LOGIN_FALHA', 'LOGIN_FALHA_2FA'] },
        createdAt: { gt: ultimoSucesso?.createdAt ?? janela },
        OR: [
          ...(ids.length ? [{ atorId: { in: ids } }] : []),
          ...(email ? [{ depois: { path: ['email'], equals: email } }] : []),
        ],
      },
    });
    if (falhas >= max) {
      throw new HttpException(
        {
          codigo: 'CONTA_BLOQUEADA_TEMPORARIAMENTE',
          mensagem: 'Muitas tentativas erradas nesta conta. Tente de novo em 15 minutos.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Aceita o passo TOTP só uma vez (atômico): o mesmo código não serve para dois logins. */
  private async consumirPassoTotp(adminId: string, passo: number): Promise<boolean> {
    const r = await this.prisma.platformAdmin.updateMany({
      where: { id: adminId, OR: [{ totpUltimoPasso: null }, { totpUltimoPasso: { lt: passo } }] },
      data: { totpUltimoPasso: passo },
    });
    return r.count === 1;
  }

  /** Abre a sessão (tokens + log de login). Usado também após cadastros públicos. */
  async concluirLogin(
    tipo: TipoAtorAutenticado,
    id: string,
    oficinaId?: string,
  ): Promise<RespostaLogin> {
    const ator = await this.atores.carregar(tipo, id);
    const { par } = await this.tokens.emitirPar({ tipo, id, oficinaId }, this.infoCliente());
    await this.registrar({
      acao: 'LOGIN_SUCESSO',
      entidade: ENTIDADE_DO_ATOR[tipo],
      entidadeId: id,
      atorTipo: tipo,
      atorId: id,
      atorNome: ator.nome,
      oficinaId: oficinaId ?? null,
    });
    return { ...par, ator };
  }

  private infoCliente() {
    const ctx = contextoAtual();
    return { ip: ctx?.ip, userAgent: ctx?.userAgent };
  }

  private registrar(entrada: EntradaAuditoria): Promise<void> {
    const ctx = contextoAtual();
    return this.auditoria.gravar({
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
      origem: ctx?.origem,
      ...entrada,
    });
  }
}
