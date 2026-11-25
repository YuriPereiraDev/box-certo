import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Atores, ExigePermissao } from '../common/auth/decorators.js';
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
  @ApiOperation({ summary: 'Logs da oficina (MASTER ou VER_LOGS)' })
  listar(@Query() filtro: FiltroLogsDto) {
    return this.logs.daOficina(filtro);
  }
}

@ApiTags('Plataforma — Logs')
@ApiBearerAuth()
@Controller('plataforma/logs')
@Atores('PLATAFORMA')
export class LogsPlataformaController {
  constructor(private readonly logs: LogsService) {}

  @Get()
  @ApiOperation({ summary: 'Logs de todas as oficinas e dos admins' })
  listar(@Query() filtro: FiltroLogsPlataformaDto) {
    return this.logs.daPlataforma(filtro);
  }
}
