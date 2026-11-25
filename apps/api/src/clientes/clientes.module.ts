import { Module } from '@nestjs/common';
import { ClienteOficinasController } from './cliente-oficinas.controller.js';

@Module({
  controllers: [ClienteOficinasController],
})
export class ClientesModule {}
