import { Module } from '@nestjs/common';
import { ConvitesController, ConvitesPublicoController } from './convites.controller.js';
import { ConvitesService } from './convites.service.js';

@Module({
  controllers: [ConvitesController, ConvitesPublicoController],
  providers: [ConvitesService],
})
export class ConvitesModule {}
