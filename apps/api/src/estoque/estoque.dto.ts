import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Aparar } from '../common/validacao/validadores.js';

const MAX_CENTAVOS = 100_000_000;

export class CriarPecaDto {
  @ApiProperty({ example: 'Pastilha de freio dianteira' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da peça' })
  @MaxLength(200)
  nome: string;

  @ApiPropertyOptional({ description: 'Código interno ou do fabricante (único na oficina)' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(60)
  codigo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(60)
  marca?: string;

  @ApiPropertyOptional({ description: 'Veículos em que serve' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(300)
  aplicacao?: string;

  @ApiProperty({ description: 'Preço de venda em centavos' })
  @IsInt({ message: 'O preço deve ser em centavos (número inteiro)' })
  @Min(0)
  @Max(MAX_CENTAVOS)
  precoVendaCentavos: number;

  @ApiPropertyOptional({
    description:
      'Custo de compra em centavos (informável por GERIR_ESTOQUE; visível só a MASTER/FINANCEIRO)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CENTAVOS)
  custoCentavos?: number;

  @ApiPropertyOptional({
    default: 0,
    description: 'Alerta quando a quantidade chegar a este valor',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  estoqueMinimo?: number;

  @ApiPropertyOptional({ example: 'Prateleira B3' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(100)
  localizacao?: string;
}

export class AtualizarPecaDto extends PartialType(CriarPecaDto) {}

export class EntradaEstoqueDto {
  @ApiProperty({ description: 'Quantidade comprada' })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantidade: number;

  @ApiProperty({ description: 'Custo unitário da compra em centavos' })
  @IsInt()
  @Min(0)
  @Max(MAX_CENTAVOS)
  custoUnitarioCentavos: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(150)
  fornecedor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(60)
  notaFiscal?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'Gerar a despesa da compra (categoria Peças)',
  })
  @IsOptional()
  @IsBoolean()
  gerarDespesa?: boolean;

  @ApiPropertyOptional({ default: false, description: 'A despesa já foi paga' })
  @IsOptional()
  @IsBoolean()
  despesaPaga?: boolean;

  @ApiPropertyOptional({ description: 'Forma de pagamento da compra' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(50)
  formaPagamento?: string;

  @ApiPropertyOptional({ description: 'Vencimento da conta (padrão: hoje)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  vencimento?: Date;
}

export class AjusteEstoqueDto {
  @ApiProperty({ description: 'Quantidade correta contada na prateleira' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quantidade: number;

  @ApiProperty({ description: 'Motivo do ajuste (obrigatório)' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo do ajuste' })
  @MaxLength(500)
  motivo: string;
}

export class FiltroEstoqueDto {
  @ApiPropertyOptional({ description: 'Busca por nome, código, marca ou aplicação' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Só peças no estoque mínimo ou abaixo' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  alerta?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  incluirInativos?: boolean;
}

export class FiltroMovimentosDto {
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
}
