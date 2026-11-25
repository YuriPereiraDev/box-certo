import { Module } from '@nestjs/common';
import { PlanoService } from '../common/utils/plano.service.js';
import { UsuariosController } from './usuarios.controller.js';
import { UsuariosService } from './usuarios.service.js';

@Module({
  controllers: [UsuariosController],
  providers: [UsuariosService, PlanoService],
})
export class UsuariosModule {}
