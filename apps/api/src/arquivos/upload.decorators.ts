import { UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { TAMANHO_MAX_IMAGEM } from './arquivos.service.js';

/** Recebe um arquivo no campo multipart "arquivo" (até 10 MB). */
export const uploadImagem = () =>
  UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: TAMANHO_MAX_IMAGEM, files: 1 } }),
  );

/** Documenta o upload no Swagger. */
export const DocUpload = () => (alvo: object, chave: string, desc: PropertyDescriptor) => {
  ApiConsumes('multipart/form-data')(alvo, chave, desc);
  ApiBody({
    schema: {
      type: 'object',
      required: ['arquivo'],
      properties: { arquivo: { type: 'string', format: 'binary' } },
    },
  })(alvo, chave, desc);
};
