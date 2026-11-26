import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Ator } from '../common/contexto/contexto.js';
import { BancoService } from '../prisma/banco.service.js';
import { StorageService } from './storage.service.js';

export const TAMANHO_MAX_IMAGEM = 10 * 1024 * 1024;

/** Tipos de imagem aceitos, reconhecidos pelos primeiros bytes (não pela extensão). */
export function detectarPdf(buffer: Buffer): { mime: string; extensao: string } | null {
  return buffer.subarray(0, 5).toString() === '%PDF-'
    ? { mime: 'application/pdf', extensao: 'pdf' }
    : null;
}

/** Tipos de imagem aceitos, reconhecidos pelos primeiros bytes. */
export function detectarImagem(buffer: Buffer): { mime: string; extensao: string } | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extensao: 'jpg' };
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', extensao: 'png' };
  }
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') {
    return { mime: 'image/webp', extensao: 'webp' };
  }
  const marca = buffer.subarray(8, 12).toString();
  if (
    buffer.subarray(4, 8).toString() === 'ftyp' &&
    ['heic', 'heix', 'mif1', 'msf1'].includes(marca)
  ) {
    return { mime: 'image/heic', extensao: 'heic' };
  }
  return null;
}

export interface ArquivoPublico {
  id: string;
  mime: string;
  tamanhoBytes: number;
  nomeOriginal: string | null;
  createdAt: Date;
  url: string;
}

/** Arquivos da oficina guardados no S3 (registro no banco + objeto no bucket). */
@Injectable()
export class ArquivosService {
  constructor(
    private readonly banco: BancoService,
    private readonly storage: StorageService,
  ) {}

  /** Valida e guarda uma imagem enviada por um usuário da oficina. */
  salvarImagem(
    arquivo: Express.Multer.File | undefined,
    dados: { oficinaId: string; entidade: string; entidadeId: string; ator: Ator },
  ) {
    return this.salvar(arquivo, dados, false);
  }

  /** Comprovantes: imagem ou PDF. */
  salvarDocumento(
    arquivo: Express.Multer.File | undefined,
    dados: { oficinaId: string; entidade: string; entidadeId: string; ator: Ator },
  ) {
    return this.salvar(arquivo, dados, true);
  }

  private async salvar(
    arquivo: Express.Multer.File | undefined,
    dados: { oficinaId: string; entidade: string; entidadeId: string; ator: Ator },
    aceitarPdf: boolean,
  ) {
    if (!arquivo?.buffer?.length)
      throw new BadRequestException('Envie o arquivo no campo "arquivo"');
    if (arquivo.size > TAMANHO_MAX_IMAGEM) {
      throw new BadRequestException('O arquivo pode ter no máximo 10 MB');
    }
    const tipo =
      detectarImagem(arquivo.buffer) ?? (aceitarPdf ? detectarPdf(arquivo.buffer) : null);
    if (!tipo) {
      throw new BadRequestException(
        aceitarPdf
          ? 'Formato não aceito. Envie PDF, JPG, PNG, WEBP ou HEIC.'
          : 'Formato não aceito. Envie JPG, PNG, WEBP ou HEIC.',
      );
    }

    const chave = `oficinas/${dados.oficinaId}/${dados.entidade.toLowerCase()}/${dados.entidadeId}/${randomUUID()}.${tipo.extensao}`;
    await this.storage.enviar(chave, arquivo.buffer, tipo.mime);
    try {
      return await this.banco.tenant.arquivo.create({
        data: {
          oficinaId: dados.oficinaId,
          chave,
          nomeOriginal: arquivo.originalname?.slice(0, 200) || null,
          mime: tipo.mime,
          tamanhoBytes: arquivo.size,
          entidade: dados.entidade,
          entidadeId: dados.entidadeId,
          enviadoPorTipo: dados.ator.tipo,
          enviadoPorId: dados.ator.id,
        },
      });
    } catch (erro) {
      await this.storage.remover(chave).catch(() => undefined);
      throw erro;
    }
  }

  /**
   * Lista arquivos de uma entidade com URL assinada. Quem chama já conferiu o acesso à
   * entidade; o oficinaId vem do token (oficina) ou da própria entidade (cliente).
   */
  async listar(oficinaId: string, entidade: string, entidadeId: string): Promise<ArquivoPublico[]> {
    const arquivos = await this.banco.sistema.arquivo.findMany({
      where: { oficinaId, entidade, entidadeId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(
      arquivos.map(async (a) => ({
        id: a.id,
        mime: a.mime,
        tamanhoBytes: a.tamanhoBytes,
        nomeOriginal: a.nomeOriginal,
        createdAt: a.createdAt,
        url: await this.storage.urlDeLeitura(a.chave),
      })),
    );
  }

  contar(entidade: string, entidadeId: string) {
    return this.banco.tenant.arquivo.count({ where: { entidade, entidadeId, deletedAt: null } });
  }

  /** Exclusão lógica (o objeto continua no bucket). */
  async remover(id: string, entidade: string, entidadeId: string) {
    const arquivo = await this.banco.tenant.arquivo.findFirst({
      where: { id, entidade, entidadeId, deletedAt: null },
    });
    if (!arquivo) throw new NotFoundException('Arquivo não encontrado');
    await this.banco.tenant.arquivo.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async conteudo(id: string): Promise<{ buffer: Buffer; mime: string } | null> {
    const arquivo = await this.banco.sistema.arquivo.findUnique({ where: { id } });
    if (!arquivo || arquivo.deletedAt) return null;
    return { buffer: await this.storage.baixar(arquivo.chave), mime: arquivo.mime };
  }
}
