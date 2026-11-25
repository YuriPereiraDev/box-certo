import { Module } from '@nestjs/common';
import { ClienteOficinasController } from './cliente-oficinas.controller.js';
import { ClientesOficinaController, PerfilClienteController } from './clientes.controller.js';
import { ClientesService } from './clientes.service.js';

@Module({
  controllers: [ClienteOficinasController, ClientesOficinaController, PerfilClienteController],
  providers: [ClientesService],
})
export class ClientesModule {}
