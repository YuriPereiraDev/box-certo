import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Fase 1: só dados básicos. Perfil e permissões entram na fase 2. */
export class AtualizarUsuarioDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefone?: string;

  @ApiPropertyOptional({ description: 'Motivo (fica registrado na auditoria)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
