import { Module } from '@nestjs/common';
import { FilaTicketsController, TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

@Module({
  controllers: [TicketsController, FilaTicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
