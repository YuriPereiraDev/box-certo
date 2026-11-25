import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const VERSAO = 'v1';

/**
 * AES-256-GCM para segredos guardados no banco (TOTP dos admins, tokens do WhatsApp).
 * Formato: v1:<iv>:<tag>:<conteúdo>, tudo em base64.
 */
@Injectable()
export class CriptografiaService {
  private readonly chave: Buffer;

  constructor(config: ConfigService) {
    this.chave = Buffer.from(config.getOrThrow<string>('ENCRYPTION_KEY'), 'base64');
  }

  criptografar(texto: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.chave, iv);
    const conteudo = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSAO, iv, tag, conteudo]
      .map((p) => (Buffer.isBuffer(p) ? p.toString('base64') : p))
      .join(':');
  }

  descriptografar(valor: string): string {
    const [versao, iv, tag, conteudo] = valor.split(':');
    if (versao !== VERSAO || !iv || !tag || !conteudo) {
      throw new Error('Valor criptografado em formato inválido');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.chave, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(conteudo, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
