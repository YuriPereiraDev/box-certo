import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Aparar, Placa } from '../common/validacao/validadores.js';

export class VeiculoDto {
  @ApiProperty({ example: 'ABC1D23', description: 'Placa antiga ou Mercosul (com ou sem hífen)' })
  @Placa()
  placa: string;

  @ApiPropertyOptional({ example: 'Volkswagen' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(60)
  marca?: string;

  @ApiPropertyOptional({ example: 'Gol' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(80)
  modelo?: string;

  @ApiPropertyOptional({ example: 2018 })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(new Date().getFullYear() + 1)
  ano?: number;

  @ApiPropertyOptional({ example: '1.6' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(40)
  motor?: string;

  @ApiPropertyOptional({ example: 'Prata' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(40)
  cor?: string;

  @ApiPropertyOptional({ example: 'Flex' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(30)
  combustivel?: string;

  @ApiPropertyOptional({ description: '17 caracteres' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() : value,
  )
  @Matches(/^[A-HJ-NPR-Z0-9]{17}$/, { message: 'Chassi inválido (17 caracteres)' })
  chassi?: string;
}

export class AtualizarVeiculoDto extends PartialType(VeiculoDto) {}

/** A oficina cadastra o veículo de um cliente vinculado a ela. */
export class CriarVeiculoOficinaDto extends VeiculoDto {
  @ApiProperty()
  @IsUUID()
  clienteId: string;
}

export class FiltroVeiculosDto {
  @ApiPropertyOptional({ description: 'Parte da placa' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  placa?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}
