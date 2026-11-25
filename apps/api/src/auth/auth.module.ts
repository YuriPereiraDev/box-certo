import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CriptografiaService } from '../common/cripto/criptografia.service.js';
import { AtoresService } from './atores.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SenhaService } from './senha.service.js';
import { TokensService } from './tokens.service.js';
import { TotpService } from './totp.service.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { issuer: 'box-certo', algorithm: 'HS256' },
        verifyOptions: { issuer: 'box-certo', algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    AtoresService,
    SenhaService,
    TotpService,
    CriptografiaService,
  ],
  exports: [TokensService, AtoresService, SenhaService, CriptografiaService],
})
export class AuthModule {}
