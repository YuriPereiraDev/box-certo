import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores } from '../common/auth/decorators.js';
import type { AtorCliente } from '../common/contexto/contexto.js';
import {
  AtualizarVeiculoDto,
  AtualizarVeiculoOficinaDto,
  CriarVeiculoOficinaDto,
  FiltroVeiculosDto,
  VeiculoDto,
} from './veiculos.dto.js';
import { VeiculosService } from './veiculos.service.js';

@ApiTags('Oficina — Veículos')
@ApiBearerAuth()
@Controller('oficina/veiculos')
@Atores('USUARIO')
export class VeiculosOficinaController {
  constructor(private readonly veiculos: VeiculosService) {}

  @Get()
  @ApiOperation({ summary: 'Veículos vinculados à oficina' })
  listar(@Query() filtro: FiltroVeiculosDto) {
    return this.veiculos.listarDaOficina(filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um veículo vinculado à oficina' })
  detalhar(@Param('id', ParseUUIDPipe) id: string) {
    return this.veiculos.detalharDaOficina(id);
  }

  @Post()
  @Auditar({ acao: 'VEICULO_CADASTRADO_PELA_OFICINA', entidade: 'Veiculo' })
  @ApiOperation({
    summary: 'Cadastra o veículo de um cliente da oficina e vincula à oficina',
    description: 'Se o cliente já tem um veículo com a mesma placa, ele é reaproveitado.',
  })
  criar(@Body() dto: CriarVeiculoOficinaDto) {
    return this.veiculos.criarNaOficina(dto);
  }

  @Patch(':id')
  @Auditar({ acao: 'VEICULO_ATUALIZADO_PELA_OFICINA' })
  @ApiOperation({
    summary: 'Atualiza dados de um veículo vinculado à oficina (placa e chassi só o cliente)',
  })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarVeiculoOficinaDto) {
    return this.veiculos.atualizarNaOficina(id, dto);
  }
}

@ApiTags('Cliente — Veículos')
@ApiBearerAuth()
@Controller('cliente/veiculos')
@Atores('CLIENTE')
export class VeiculosClienteController {
  constructor(private readonly veiculos: VeiculosService) {}

  @Get()
  @ApiOperation({ summary: 'Meus veículos' })
  listar(@AtorAtual() ator: AtorCliente) {
    return this.veiculos.listarDoCliente(ator.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um veículo meu' })
  detalhar(@AtorAtual() ator: AtorCliente, @Param('id', ParseUUIDPipe) id: string) {
    return this.veiculos.detalharDoCliente(ator.id, id);
  }

  @Post()
  @Auditar({ acao: 'VEICULO_CADASTRADO_PELO_CLIENTE' })
  @ApiOperation({ summary: 'Cadastra um veículo' })
  criar(@AtorAtual() ator: AtorCliente, @Body() dto: VeiculoDto) {
    return this.veiculos.criarDoCliente(ator.id, dto);
  }

  @Patch(':id')
  @Auditar({ acao: 'VEICULO_ATUALIZADO_PELO_CLIENTE' })
  @ApiOperation({ summary: 'Atualiza um veículo meu' })
  atualizar(
    @AtorAtual() ator: AtorCliente,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarVeiculoDto,
  ) {
    return this.veiculos.atualizarDoCliente(ator.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditar({ acao: 'VEICULO_REMOVIDO_PELO_CLIENTE' })
  @ApiOperation({ summary: 'Remove um veículo meu (exclusão lógica)' })
  async remover(@AtorAtual() ator: AtorCliente, @Param('id', ParseUUIDPipe) id: string) {
    await this.veiculos.removerDoCliente(ator.id, id);
  }
}
