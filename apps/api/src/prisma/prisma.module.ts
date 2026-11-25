import { Global, Module } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from './banco.service.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, AuditoriaService, BancoService],
  exports: [PrismaService, AuditoriaService, BancoService],
})
export class PrismaModule {}
