import { Module } from '@nestjs/common';
import { LogsOficinaController, LogsPlataformaController } from './logs.controller.js';
import { LogsService } from './logs.service.js';

@Module({
  controllers: [LogsOficinaController, LogsPlataformaController],
  providers: [LogsService],
})
export class AuditoriaModule {}
