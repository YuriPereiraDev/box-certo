import { Module } from '@nestjs/common';
import {
  AgendamentosClienteController,
  AgendamentosOficinaController,
} from './agendamentos.controller.js';
import { AgendamentosService } from './agendamentos.service.js';

@Module({
  controllers: [AgendamentosOficinaController, AgendamentosClienteController],
  providers: [AgendamentosService],
  exports: [AgendamentosService],
})
export class AgendamentosModule {}
