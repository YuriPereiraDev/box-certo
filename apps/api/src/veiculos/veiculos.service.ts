import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { exigirOficinaId } from '../common/contexto/contexto.js';
import { normalizarPlaca } from '../common/utils/documentos.js';
import { BancoService } from '../prisma/banco.service.js';
import type {
  AtualizarVeiculoDto,
  AtualizarVeiculoOficinaDto,
  CriarVeiculoOficinaDto,
  FiltroVeiculosDto,
  VeiculoDto,
} from './veiculos.dto.js';

export const SELECAO_VEICULO = {
  id: true,
  clienteId: true,
  placa: true,
  marca: true,
  modelo: true,
  ano: true,
  motor: true,
  cor: true,
  combustivel: true,
  chassi: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Veículos. O veículo é do cliente; a oficina só enxerga os vinculados a ela (VeiculoOficina),
 * criados quando ela cadastra o veículo ou quando o cliente agenda/abre OS nela.
 */
@Injectable()
export class VeiculosService {
  constructor(private readonly banco: BancoService) {}

  // ----------------------------------------------------------------- oficina

  async listarDaOficina(f: FiltroVeiculosDto) {
    const vinculos = await this.banco.tenant.veiculoOficina.findMany({
      where: {
        veiculo: {
          ativo: true,
          clienteId: f.clienteId,
          placa: f.placa ? { contains: normalizarPlaca(f.placa) } : undefined,
        },
      },
      select: {
        veiculo: {
          select: {
            ...SELECAO_VEICULO,
            cliente: { select: { id: true, nome: true, telefone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return vinculos.map((v) => v.veiculo);
  }

  async detalharDaOficina(veiculoId: string) {
    const vinculo = await this.banco.tenant.veiculoOficina.findFirst({
      where: { veiculoId },
      select: {
        createdAt: true,
        veiculo: {
          select: {
            ...SELECAO_VEICULO,
            cliente: { select: { id: true, nome: true, telefone: true } },
          },
        },
      },
    });
    if (!vinculo) throw new NotFoundException('Veículo não encontrado');
    return { ...vinculo.veiculo, vinculadoEm: vinculo.createdAt };
  }

  /** Cadastra (ou reaproveita, pela placa) o veículo de um cliente da oficina e cria o vínculo. */
  async criarNaOficina(dto: CriarVeiculoOficinaDto) {
    const oficinaId = exigirOficinaId();
    const { clienteId, ...dados } = dto;
    const clienteDaOficina = await this.banco.tenant.clienteOficina.findFirst({
      where: { clienteId },
    });
    if (!clienteDaOficina) throw new NotFoundException('Cliente não encontrado');

    const veiculo = await this.salvarDoCliente(clienteId, dados, { reaproveitarAtivo: true });
    await this.vincular(veiculo.id, oficinaId);
    return this.detalharDaOficina(veiculo.id);
  }

  async atualizarNaOficina(veiculoId: string, dto: AtualizarVeiculoOficinaDto) {
    await this.detalharDaOficina(veiculoId);
    await this.banco.sistema.veiculo.update({ where: { id: veiculoId }, data: dto });
    return this.detalharDaOficina(veiculoId);
  }

  /** Cria o vínculo veículo↔oficina se ainda não existir (usado também por agendamento/OS). */
  async vincular(veiculoId: string, oficinaId: string): Promise<void> {
    const existe = await this.banco.tenant.veiculoOficina.findFirst({ where: { veiculoId } });
    if (!existe) await this.banco.tenant.veiculoOficina.create({ data: { veiculoId, oficinaId } });
  }

  // ----------------------------------------------------------------- cliente

  listarDoCliente(clienteId: string) {
    return this.banco.sistema.veiculo.findMany({
      where: { clienteId, ativo: true },
      select: SELECAO_VEICULO,
      orderBy: { createdAt: 'asc' },
    });
  }

  async detalharDoCliente(clienteId: string, id: string) {
    const veiculo = await this.banco.sistema.veiculo.findFirst({
      where: { id, clienteId, ativo: true },
      select: SELECAO_VEICULO,
    });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado');
    return veiculo;
  }

  criarDoCliente(clienteId: string, dto: VeiculoDto) {
    return this.salvarDoCliente(clienteId, dto, { reaproveitarAtivo: false });
  }

  async atualizarDoCliente(clienteId: string, id: string, dto: AtualizarVeiculoDto) {
    await this.detalharDoCliente(clienteId, id);
    return this.banco.sistema.veiculo.update({ where: { id }, data: dto, select: SELECAO_VEICULO });
  }

  /** Exclusão lógica. */
  async removerDoCliente(clienteId: string, id: string) {
    await this.detalharDoCliente(clienteId, id);
    await this.banco.sistema.veiculo.update({ where: { id }, data: { ativo: false } });
  }

  // ----------------------------------------------------------------- interno

  /** Cria o veículo; se a placa já existir para o cliente, reativa/atualiza o mesmo registro. */
  private async salvarDoCliente(
    clienteId: string,
    dados: VeiculoDto,
    opcoes: { reaproveitarAtivo: boolean },
  ) {
    const existente = await this.banco.sistema.veiculo.findUnique({
      where: { clienteId_placa: { clienteId, placa: dados.placa } },
    });
    if (existente?.ativo && !opcoes.reaproveitarAtivo) {
      throw new ConflictException('Você já cadastrou um veículo com esta placa');
    }
    if (existente) {
      // Pela oficina, um veículo já cadastrado não tem o chassi trocado (só preenchido se vazio).
      const { placa: _p, chassi, ...resto } = dados;
      return this.banco.sistema.veiculo.update({
        where: { id: existente.id },
        data: opcoes.reaproveitarAtivo
          ? { ...resto, chassi: existente.chassi ?? chassi, ativo: true }
          : { ...dados, ativo: true },
        select: SELECAO_VEICULO,
      });
    }
    return this.banco.sistema.veiculo.create({
      data: { ...dados, clienteId },
      select: SELECAO_VEICULO,
    });
  }
}
