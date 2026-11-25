import { Injectable, NotFoundException } from '@nestjs/common';
import { exigirOficinaId } from '../common/contexto/contexto.js';
import { somenteDigitos } from '../common/utils/cpf.js';
import type { Prisma } from '../generated/prisma/client.js';
import { BancoService } from '../prisma/banco.service.js';
import { SELECAO_VEICULO } from '../veiculos/veiculos.service.js';
import type { AtualizarPerfilClienteDto, FiltroClientesDto } from './clientes.dto.js';

/** Dados do cliente que a oficina pode ver (nunca senhaHash). */
export const SELECAO_CLIENTE = {
  id: true,
  nome: true,
  cpf: true,
  dataNascimento: true,
  rg: true,
  email: true,
  telefone: true,
  cep: true,
  rua: true,
  numero: true,
  complemento: true,
  bairro: true,
  cidade: true,
  uf: true,
  createdAt: true,
} as const;

function filtroBusca(q?: string): Prisma.ClienteWhereInput | undefined {
  const termo = q?.trim();
  if (!termo) return undefined;
  const digitos = somenteDigitos(termo);
  return {
    OR: [
      { nome: { contains: termo, mode: 'insensitive' } },
      { email: { contains: termo, mode: 'insensitive' } },
      ...(digitos.length >= 3
        ? [{ cpf: { contains: digitos } }, { telefone: { contains: digitos } }]
        : []),
    ],
  };
}

@Injectable()
export class ClientesService {
  constructor(private readonly banco: BancoService) {}

  // ----------------------------------------------------------------- oficina

  /** Só clientes vinculados à oficina do token. */
  async listarDaOficina(f: FiltroClientesDto) {
    const vinculos = await this.banco.tenant.clienteOficina.findMany({
      where: { cliente: { ativo: true, ...filtroBusca(f.q) } },
      select: { observacoesInternas: true, createdAt: true, cliente: { select: SELECAO_CLIENTE } },
      orderBy: { cliente: { nome: 'asc' } },
    });
    return vinculos.map((v) => ({
      ...v.cliente,
      observacoesInternas: v.observacoesInternas,
      vinculadoEm: v.createdAt,
    }));
  }

  /** Dados do cliente + só os veículos vinculados a esta oficina. */
  async detalharDaOficina(clienteId: string) {
    const vinculo = await this.banco.tenant.clienteOficina.findFirst({
      where: { clienteId },
      select: { observacoesInternas: true, createdAt: true, cliente: { select: SELECAO_CLIENTE } },
    });
    if (!vinculo) throw new NotFoundException('Cliente não encontrado');
    const veiculos = await this.banco.tenant.veiculoOficina.findMany({
      where: { veiculo: { clienteId, ativo: true } },
      select: { veiculo: { select: SELECAO_VEICULO } },
    });
    return {
      ...vinculo.cliente,
      observacoesInternas: vinculo.observacoesInternas,
      vinculadoEm: vinculo.createdAt,
      veiculos: veiculos.map((v) => v.veiculo),
    };
  }

  async atualizarObservacoes(clienteId: string, observacoesInternas: string | null) {
    await this.detalharDaOficina(clienteId);
    await this.banco.tenant.clienteOficina.update({
      where: { clienteId_oficinaId: { clienteId, oficinaId: exigirOficinaId() } },
      data: { observacoesInternas },
    });
    return this.detalharDaOficina(clienteId);
  }

  // ----------------------------------------------------------------- cliente

  async perfil(clienteId: string) {
    const cliente = await this.banco.sistema.cliente.findUnique({
      where: { id: clienteId },
      select: { ...SELECAO_CLIENTE, consentimentoLgpdEm: true },
    });
    if (!cliente) throw new NotFoundException('Cliente não encontrado');
    return cliente;
  }

  atualizarPerfil(clienteId: string, dto: AtualizarPerfilClienteDto) {
    return this.banco.sistema.cliente.update({
      where: { id: clienteId },
      data: dto,
      select: { ...SELECAO_CLIENTE, consentimentoLgpdEm: true },
    });
  }
}
