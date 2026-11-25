import { Global, Module } from '@nestjs/common';
import { ArquivosService } from './arquivos.service.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [StorageService, ArquivosService],
  exports: [StorageService, ArquivosService],
})
export class ArquivosModule {}
