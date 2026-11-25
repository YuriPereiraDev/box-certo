import { Injectable } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';

const EMISSOR = 'Box Certo';

/** TOTP (RFC 6238) para o 2FA dos admins da plataforma. */
@Injectable()
export class TotpService {
  gerarSegredo(): string {
    return new Secret({ size: 20 }).base32;
  }

  urlOtpAuth(segredo: string, email: string): string {
    return this.totp(segredo, email).toString();
  }

  /** Aceita o código atual e o vizinho (±30 s) para tolerar relógio desajustado. */
  validar(segredo: string, codigo: string): boolean {
    if (!/^\d{6}$/.test(codigo)) return false;
    return this.totp(segredo).validate({ token: codigo, window: 1 }) !== null;
  }

  gerarCodigo(segredo: string): string {
    return this.totp(segredo).generate();
  }

  private totp(segredo: string, email = 'admin'): TOTP {
    return new TOTP({
      issuer: EMISSOR,
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(segredo),
    });
  }
}
