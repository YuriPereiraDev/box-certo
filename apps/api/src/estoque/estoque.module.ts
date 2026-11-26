import { Global, Module } from '@nestjs/common';
import { EstoqueController } from './estoque.controller.js';
import { EstoqueService } from './estoque.service.js';
import { ReservasEstoqueService } from './reservas-estoque.service.js';

@Global()
@Module({
  controllers: [EstoqueController],
  providers: [EstoqueService, ReservasEstoqueService],
  exports: [EstoqueService, ReservasEstoqueService],
})
export class EstoqueModule {}
