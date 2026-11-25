import { Module } from '@nestjs/common';
import { AdminsController } from './admins.controller.js';

@Module({
  controllers: [AdminsController],
})
export class PlatformModule {}
