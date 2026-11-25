import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Publico } from '../common/auth/decorators.js';
import { HealthService, type ResultadoHealth } from './health.service.js';

@ApiTags('Health')
@Controller('health')
@Publico()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Verifica se a API e o banco estão no ar' })
  @ApiOkResponse({ description: 'API e banco funcionando' })
  @ApiServiceUnavailableResponse({ description: 'Algum serviço essencial está fora do ar' })
  async verificar(): Promise<ResultadoHealth> {
    const resultado = await this.health.verificar();
    if (resultado.status !== 'ok') {
      throw new ServiceUnavailableException(resultado);
    }
    return resultado;
  }
}
