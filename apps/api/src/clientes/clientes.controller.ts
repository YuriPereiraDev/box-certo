import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores } from '../common/auth/decorators.js';
import type { AtorCliente } from '../common/contexto/contexto.js';
import {
  AtualizarPerfilClienteDto,
  FiltroClientesDto,
  ObservacoesClienteDto,
} from './clientes.dto.js';
import { ClientesService } from './clientes.service.js';

@ApiTags('Oficina — Clientes')
@ApiBearerAuth()
@Controller('oficina/clientes')
@Atores('USUARIO')
export class ClientesOficinaController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  @ApiOperation({ summary: 'Clientes vinculados à oficina' })
  listar(@Query() filtro: FiltroClientesDto) {
    return this.clientes.listarDaOficina(filtro);
  }

  @Get(':clienteId')
  @ApiOperation({ summary: 'Detalha o cliente e os veículos dele vinculados à oficina' })
  detalhar(@Param('clienteId', ParseUUIDPipe) clienteId: string) {
    return this.clientes.detalharDaOficina(clienteId);
  }

  @Patch(':clienteId/observacoes')
  @Auditar({ acao: 'CLIENTE_OBSERVACOES_ALTERADAS' })
  @ApiOperation({ summary: 'Anotações internas sobre o cliente (o cliente não vê)' })
  observacoes(
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @Body() dto: ObservacoesClienteDto,
  ) {
    return this.clientes.atualizarObservacoes(clienteId, dto.observacoesInternas ?? null);
  }
}

@ApiTags('Cliente')
@ApiBearerAuth()
@Controller('cliente/perfil')
@Atores('CLIENTE')
export class PerfilClienteController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  @ApiOperation({ summary: 'Meus dados' })
  perfil(@AtorAtual() ator: AtorCliente) {
    return this.clientes.perfil(ator.id);
  }

  @Patch()
  @Auditar({ acao: 'CLIENTE_PERFIL_ATUALIZADO' })
  @ApiOperation({ summary: 'Atualiza nome, telefone e endereço' })
  atualizar(@AtorAtual() ator: AtorCliente, @Body() dto: AtualizarPerfilClienteDto) {
    return this.clientes.atualizarPerfil(ator.id, dto);
  }
}
