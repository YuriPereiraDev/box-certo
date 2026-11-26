import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Tempo de validade das URLs assinadas de leitura. */
export const VALIDADE_URL_SEGUNDOS = 15 * 60;

/**
 * Armazenamento compatível com S3: SeaweedFS em dev, Cloudflare R2 ou S3 em produção.
 * O bucket é privado; a leitura é feita por URL assinada de curta duração.
 */
@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  /** Cliente só para assinar URLs com o endereço público (S3_PUBLIC_ENDPOINT). */
  private readonly s3Publico: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    const base = {
      region: config.get<string>('S3_REGION') ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      },
    };
    const interno = config.getOrThrow<string>('S3_ENDPOINT');
    this.s3 = new S3Client({ ...base, endpoint: interno });
    // A API pode falar com o storage por um endereço interno, mas o app precisa do público.
    this.s3Publico = new S3Client({
      ...base,
      endpoint: config.get<string>('S3_PUBLIC_ENDPOINT') || interno,
    });
  }

  /** Envia um Buffer ou, em streaming, o arquivo temporário do upload. */
  async enviar(
    chave: string,
    conteudo: Buffer | { caminho: string; tamanho: number },
    mime: string,
  ): Promise<void> {
    const corpo = Buffer.isBuffer(conteudo)
      ? { Body: conteudo }
      : { Body: createReadStream(conteudo.caminho), ContentLength: conteudo.tamanho };
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: chave, ContentType: mime, ...corpo }),
    );
  }

  async baixar(chave: string): Promise<Buffer> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: chave }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  urlDeLeitura(chave: string): Promise<string> {
    return getSignedUrl(this.s3Publico, new GetObjectCommand({ Bucket: this.bucket, Key: chave }), {
      expiresIn: VALIDADE_URL_SEGUNDOS,
    });
  }

  /** Só para limpeza de falhas no upload; arquivos de usuário são removidos logicamente. */
  async remover(chave: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: chave }));
  }
}
