import { Module } from '@nestjs/common';
import { OficinaController, OficinasPublicoController } from './oficinas.controller.js';
import { OficinasService } from './oficinas.service.js';

@Module({
  controllers: [OficinasPublicoController, OficinaController],
  providers: [OficinasService],
})
export class OficinasModule {}
