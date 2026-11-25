import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TipoAtor } from '../generated/prisma/enums.js';

export class FiltroLogsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite = 50;

  @ApiPropertyOptional({ example: 'LOGIN_FALHA' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  acao?: string;

  @ApiPropertyOptional({ example: 'User' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entidade?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entidadeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  atorId?: string;

  @ApiPropertyOptional({ enum: TipoAtor })
  @IsOptional()
  @IsEnum(TipoAtor)
  atorTipo?: TipoAtor;

  @ApiPropertyOptional({ description: 'Data inicial (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  de?: Date;

  @ApiPropertyOptional({ description: 'Data final (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  ate?: Date;
}

export class FiltroLogsPlataformaDto extends FiltroLogsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  oficinaId?: string;
}
