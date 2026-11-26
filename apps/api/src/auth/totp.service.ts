import { Injectable } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';

const EMISSOR = 'Box Certo';
const PERIODO_SEGUNDOS = 30;

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
    return this.passoValido(segredo, codigo) !== null;
  }

  /**
   * Passo (janela de 30 s) a que o código pertence, ou null se inválido. Quem chama guarda o
   * último passo aceito e recusa passos iguais ou anteriores: o mesmo código não vale duas vezes.
   */
  passoValido(segredo: string, codigo: string, agora = Date.now()): number | null {
    if (!/^\d{6}$/.test(codigo)) return null;
    const delta = this.totp(segredo).validate({ token: codigo, window: 1, timestamp: agora });
    return delta === null ? null : Math.floor(agora / 1000 / PERIODO_SEGUNDOS) + delta;
  }

  gerarCodigo(segredo: string, timestamp = Date.now()): string {
    return this.totp(segredo).generate({ timestamp });
  }

  private totp(segredo: string, email = 'admin'): TOTP {
    return new TOTP({
      issuer: EMISSOR,
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: PERIODO_SEGUNDOS,
      secret: Secret.fromBase32(segredo),
    });
  }
}
