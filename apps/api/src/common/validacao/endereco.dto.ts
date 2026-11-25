import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Aparar, IsCep, IsUf, SoDigitos } from './validadores.js';

/** Endereço opcional (o app preenche pelo CEP via ViaCEP). */
export class EnderecoOpcionalDto {
  @ApiPropertyOptional({ example: '01310100' })
  @IsOptional()
  @SoDigitos()
  @IsCep()
  cep?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(200)
  rua?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(20)
  numero?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(100)
  complemento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(100)
  bairro?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(100)
  cidade?: string;

  @ApiPropertyOptional({ example: 'SP' })
  @IsOptional()
  @Aparar()
  @IsUf()
  uf?: string;
}
