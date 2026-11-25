import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SemAuditoriaDeRequisicao } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores, Publico } from '../common/auth/decorators.js';
import type { Ator } from '../common/contexto/contexto.js';
import { AuthService } from './auth.service.js';
import {
  Ativar2faDto,
  Config2faDto,
  LoginClienteDto,
  LoginOficinaDto,
  LoginPlataformaDto,
  RefreshDto,
} from './dto.js';

/** Limite de tentativas de login por IP por minuto (RATE_LIMIT_LOGIN, padrão 5). */
const LimiteLogin = () =>
  Throttle({
    default: { limit: () => Number(process.env.RATE_LIMIT_LOGIN ?? 5), ttl: 60_000 },
  });

@ApiTags('Auth')
@Controller('auth')
@SemAuditoriaDeRequisicao()
@ApiTooManyRequestsResponse({ description: 'Muitas tentativas' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('oficina/login')
  @Publico()
  @LimiteLogin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login de usuário da oficina (master, mecânico, financeiro)' })
  @ApiUnauthorizedResponse({ description: 'E-mail ou senha inválidos' })
  @ApiForbiddenResponse({ description: 'Oficina suspensa ou cancelada' })
  @ApiConflictResponse({ description: 'E-mail em mais de uma oficina: informe oficinaId' })
  loginOficina(@Body() dto: LoginOficinaDto) {
    return this.auth.loginOficina(dto);
  }

  @Post('cliente/login')
  @Publico()
  @LimiteLogin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login do cliente (e-mail ou CPF)' })
  @ApiUnauthorizedResponse({ description: 'Login ou senha inválidos' })
  loginCliente(@Body() dto: LoginClienteDto) {
    return this.auth.loginCliente(dto);
  }

  @Post('plataforma/login')
  @Publico()
  @LimiteLogin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login de admin da plataforma (2FA obrigatório)',
    description:
      'Sem 2FA configurado, devolve `requerConfiguracao2fa` e um `tokenConfiguracao`. ' +
      'Com 2FA ativo, exige `codigoTotp` (401 TOTP_OBRIGATORIO / TOTP_INVALIDO).',
  })
  loginPlataforma(@Body() dto: LoginPlataformaDto) {
    return this.auth.loginPlataforma(dto);
  }

  @Post('plataforma/2fa/configurar')
  @Publico()
  @LimiteLogin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gera o segredo TOTP (mostrar como QR code no app)' })
  configurar2fa(@Body() dto: Config2faDto) {
    return this.auth.configurar2fa(dto.tokenConfiguracao);
  }

  @Post('plataforma/2fa/ativar')
  @Publico()
  @LimiteLogin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirma o primeiro código e ativa o 2FA; devolve os tokens' })
  ativar2fa(@Body() dto: Ativar2faDto) {
    return this.auth.ativar2fa(dto.tokenConfiguracao, dto.codigo);
  }

  @Post('refresh')
  @Publico()
  @LimiteLogin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Troca o refresh token por um novo par (rotativo)' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @Publico()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o refresh token' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @Atores('PLATAFORMA', 'USUARIO', 'CLIENTE')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dados de quem está logado' })
  me(@AtorAtual() ator: Ator) {
    return ator;
  }
}
