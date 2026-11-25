import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Aparar } from '../common/validacao/validadores.js';
import { TipoItem } from '../generated/prisma/enums.js';

export class CriarItemTabelaDto {
  @ApiProperty({ example: 'Troca de óleo 5W30' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do item' })
  @MaxLength(200)
  nome: string;

  @ApiProperty({ enum: TipoItem })
  @IsEnum(TipoItem)
  tipo: TipoItem;

  @ApiProperty({ description: 'Preço em centavos', example: 15000 })
  @IsInt({ message: 'O preço deve ser em centavos (número inteiro)' })
  @Min(0)
  @Max(100_000_000)
  precoCentavos: number;

  @ApiPropertyOptional({ description: 'Tempo estimado em minutos' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  tempoEstimadoMin?: number;

  @ApiPropertyOptional({ description: 'Link de afiliado padrão (só peças)' })
  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true }, { message: 'Link inválido' })
  @MaxLength(2000)
  linkAfiliadoPadrao?: string;
}

export class AtualizarItemTabelaDto extends PartialType(CriarItemTabelaDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class FiltroTabelaDto {
  @ApiPropertyOptional({ description: 'Busca pelo nome' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: TipoItem })
  @IsOptional()
  @IsEnum(TipoItem)
  tipo?: TipoItem;

  @ApiPropertyOptional({ description: 'Incluir itens desativados', default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  incluirInativos?: boolean;
}
