import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.s3 = new S3Client({
      endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
      region: config.get<string>('S3_REGION') ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      },
    });
  }

  async enviar(chave: string, conteudo: Buffer, mime: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: chave, Body: conteudo, ContentType: mime }),
    );
  }

  async baixar(chave: string): Promise<Buffer> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: chave }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  urlDeLeitura(chave: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: chave }), {
      expiresIn: VALIDADE_URL_SEGUNDOS,
    });
  }

  /** Só para limpeza de falhas no upload; arquivos de usuário são removidos logicamente. */
  async remover(chave: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: chave }));
  }
}
