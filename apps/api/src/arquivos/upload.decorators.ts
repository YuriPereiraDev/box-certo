import { randomUUID } from 'node:crypto';
import { mkdirSync, unlink } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import type { Request } from 'express';
import { diskStorage } from 'multer';
import { finalize, type Observable } from 'rxjs';
import { TAMANHO_MAX_IMAGEM, TAMANHO_MAX_VIDEO } from './arquivos.service.js';

/**
 * Uploads vão para um arquivo temporário em disco (não para a memória) e seguem em streaming
 * para o S3. Vários vídeos de 50 MB ao mesmo tempo não derrubam o servidor.
 */
export const PASTA_UPLOADS = join(tmpdir(), 'box-certo-uploads');
mkdirSync(PASTA_UPLOADS, { recursive: true });

const armazenamento = diskStorage({
  destination: PASTA_UPLOADS,
  filename: (_req, _arquivo, cb) => cb(null, randomUUID()),
});

/** Apaga o temporário sempre, deu certo ou não (inclusive quando a validação recusa). */
@Injectable()
export class LimparUploadInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { file?: Express.Multer.File }>();
    return next.handle().pipe(
      finalize(() => {
        if (req.file?.path) unlink(req.file.path, () => undefined);
      }),
    );
  }
}

const upload = (tamanhoMax: number) =>
  UseInterceptors(
    FileInterceptor('arquivo', {
      storage: armazenamento,
      limits: { fileSize: tamanhoMax, files: 1 },
    }),
    LimparUploadInterceptor,
  );

/** Recebe um arquivo no campo multipart "arquivo" (até 10 MB). */
export const uploadImagem = () => upload(TAMANHO_MAX_IMAGEM);

/** Anexo de ticket: foto ou vídeo (até 50 MB; o limite por tipo é conferido no service). */
export const uploadAnexoTicket = () => upload(TAMANHO_MAX_VIDEO);

/** Documenta o upload no Swagger. */
export const DocUpload = () =>
  applyDecorators(
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['arquivo'],
        properties: { arquivo: { type: 'string', format: 'binary' } },
      },
    }),
  );
