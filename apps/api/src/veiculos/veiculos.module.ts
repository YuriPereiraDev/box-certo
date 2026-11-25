import { Module } from '@nestjs/common';
import { VeiculosClienteController, VeiculosOficinaController } from './veiculos.controller.js';
import { VeiculosService } from './veiculos.service.js';

@Module({
  controllers: [VeiculosOficinaController, VeiculosClienteController],
  providers: [VeiculosService],
  exports: [VeiculosService],
})
export class VeiculosModule {}
