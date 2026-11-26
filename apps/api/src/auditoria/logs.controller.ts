import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AtorAtual, Atores, ExigePermissao } from '../common/auth/decorators.js';
import type { AtorPlataforma, AtorUsuario } from '../common/contexto/contexto.js';
import { FiltroLogsDto, FiltroLogsPlataformaDto } from './logs.dto.js';
import { LogsService } from './logs.service.js';

@ApiTags('Oficina — Logs')
@ApiBearerAuth()
@Controller('oficina/logs')
@Atores('USUARIO')
export class LogsOficinaController {
  constructor(private readonly logs: LogsService) {}

  @Get()
  @ExigePermissao('VER_LOGS')
  @ApiOperation({
    summary: 'Logs da oficina (MASTER ou VER_LOGS)',
    description:
      'Dados de despesas, salários e custos aparecem só para quem tem a permissão correspondente.',
  })
  listar(@AtorAtual() a: AtorUsuario, @Query() filtro: FiltroLogsDto) {
    return this.logs.daOficina(a, filtro);
  }
}

@ApiTags('Plataforma — Logs')
@ApiBearerAuth()
@Controller('plataforma/logs')
@Atores('PLATAFORMA')
export class LogsPlataformaController {
  constructor(private readonly logs: LogsService) {}

  @Get()
  @ApiOperation({
    summary: 'Logs de todas as oficinas e dos admins',
    description: 'Sem FINANCEIRO, valores em dinheiro aparecem como [RESTRITO].',
  })
  listar(@AtorAtual() a: AtorPlataforma, @Query() filtro: FiltroLogsPlataformaDto) {
    return this.logs.daPlataforma(a, filtro);
  }
}
