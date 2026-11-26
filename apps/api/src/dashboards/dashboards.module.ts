import { Module } from '@nestjs/common';
import { DespesasModule } from '../despesas/despesas.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { ExportacaoDashboardService } from './exportacao.service.js';

@Module({
  imports: [DespesasModule],
  controllers: [DashboardController],
  providers: [DashboardService, ExportacaoDashboardService],
})
export class DashboardsModule {}
