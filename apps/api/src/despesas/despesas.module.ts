import { Module } from '@nestjs/common';
import {
  CategoriasDespesaController,
  DespesasController,
  RecorrentesController,
} from './despesas.controller.js';
import { DespesasService } from './despesas.service.js';
import { RecorrentesService } from './recorrentes.service.js';

@Module({
  // Rotas fixas (categorias, recorrentes) antes de `oficina/despesas/:id`.
  controllers: [CategoriasDespesaController, RecorrentesController, DespesasController],
  providers: [DespesasService, RecorrentesService],
  exports: [DespesasService, RecorrentesService],
})
export class DespesasModule {}
