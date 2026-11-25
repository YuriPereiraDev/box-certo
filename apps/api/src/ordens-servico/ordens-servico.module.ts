import { Module } from '@nestjs/common';
import {
  HistoricoVeiculoOficinaController,
  OrdensServicoClienteController,
  OrdensServicoController,
} from './ordens-servico.controller.js';
import { OrdensServicoClienteService } from './ordens-servico-cliente.service.js';
import { OrdensServicoService } from './ordens-servico.service.js';
import { PdfService } from './pdf.service.js';

@Module({
  controllers: [
    OrdensServicoController,
    HistoricoVeiculoOficinaController,
    OrdensServicoClienteController,
  ],
  providers: [OrdensServicoService, OrdensServicoClienteService, PdfService],
  exports: [OrdensServicoService],
})
export class OrdensServicoModule {}
