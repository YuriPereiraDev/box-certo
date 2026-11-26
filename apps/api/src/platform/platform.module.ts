import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { AdminsController } from './admins.controller.js';
import { AdminsService } from './admins.service.js';
import { AlertasService } from './alertas.service.js';
import { AvisosService } from './avisos.service.js';
import { ContasService } from './contas.service.js';
import { DashboardPlataformaService } from './dashboard-plataforma.service.js';
import { OficinasPlataformaService } from './oficinas-plataforma.service.js';
import {
  AvisosVigentesController,
  ContasController,
  DashboardPlataformaController,
  OficinasPlataformaController,
  PlanosController,
  SuporteController,
} from './plataforma.controller.js';
import { PlanosService } from './planos.service.js';
import { SuporteService } from './suporte.service.js';

@Module({
  imports: [TicketsModule],
  controllers: [
    AdminsController,
    DashboardPlataformaController,
    OficinasPlataformaController,
    PlanosController,
    ContasController,
    SuporteController,
    AvisosVigentesController,
  ],
  providers: [
    AdminsService,
    OficinasPlataformaService,
    PlanosService,
    ContasService,
    AvisosService,
    SuporteService,
    AlertasService,
    DashboardPlataformaService,
  ],
})
export class PlatformModule {}
