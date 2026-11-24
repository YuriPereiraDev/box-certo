import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Ambiente {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/** Variáveis de ambiente obrigatórias para a API subir. */
export class EnvVars {
  @IsEnum(Ambiente)
  NODE_ENV: Ambiente = Ambiente.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsNotEmpty()
  ENCRYPTION_KEY: string;

  @IsString()
  @IsOptional()
  CORS_ORIGINS?: string;

  @IsString()
  @IsOptional()
  APP_URL?: string;
}

export function validarEnv(config: Record<string, unknown>): EnvVars {
  const env = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const erros = validateSync(env, { skipMissingProperties: false });
  if (erros.length > 0) {
    const detalhes = erros
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Configuração inválida no .env:\n  ${detalhes}`);
  }
  if (Buffer.from(env.ENCRYPTION_KEY, 'base64').length !== 32) {
    throw new Error('ENCRYPTION_KEY deve ter exatamente 32 bytes em base64.');
  }
  return env;
}
