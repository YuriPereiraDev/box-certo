import { Throttle } from '@nestjs/throttler';

/**
 * Limite de tentativas por IP por minuto para login e cadastros públicos
 * (RATE_LIMIT_LOGIN, padrão 5).
 */
export const LimiteLogin = () =>
  Throttle({
    default: { limit: () => Number(process.env.RATE_LIMIT_LOGIN ?? 5), ttl: 60_000 },
  });
