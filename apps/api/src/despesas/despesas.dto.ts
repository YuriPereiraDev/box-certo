import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Aparar } from '../common/validacao/validadores.js';
import { StatusDespesa, SubtipoSalario } from '../generated/prisma/enums.js';

const MAX_CENTAVOS = 1_000_000_000;
const DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

class CamposSalario {
  @ApiPropertyOptional({ description: 'Funcionário pago (só na categoria de salários)' })
  @IsOptional()
  @IsUUID()
  funcionarioId?: string;

  @ApiPropertyOptional({ enum: SubtipoSalario, description: 'Obrigatório quando há funcionário' })
  @IsOptional()
  @IsEnum(SubtipoSalario)
  subtipoSalario?: SubtipoSalario;
}

export class CriarDespesaDto extends CamposSalario {
  @ApiPropertyOptional({ description: 'Data da despesa (padrão: agora)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  data?: Date;

  @ApiProperty({ example: 'Conta de energia de novembro' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Descreva a despesa' })
  @MaxLength(300)
  descricao: string;

  @ApiProperty({ description: 'Valor em centavos' })
  @IsInt({ message: 'O valor deve ser em centavos (número inteiro)' })
  @Min(1)
  @Max(MAX_CENTAVOS)
  valorCentavos: number;

  @ApiProperty()
  @IsUUID()
  categoriaId: string;

  @ApiPropertyOptional({ enum: StatusDespesa, default: 'A_PAGAR' })
  @IsOptional()
  @IsEnum(StatusDespesa)
  status?: StatusDespesa;

  @ApiPropertyOptional({ description: 'Vencimento (contas a pagar)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  vencimento?: Date;

  @ApiPropertyOptional({ description: 'Quando foi paga (padrão: agora, se status PAGO)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  pagoEm?: Date;

  @ApiPropertyOptional({ example: 'PIX' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(50)
  formaPagamento?: string;
}

export class AtualizarDespesaDto extends PartialType(CriarDespesaDto) {
  @ApiPropertyOptional({ description: 'Motivo da alteração (vai para a auditoria)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class PagarDespesaDto {
  @ApiPropertyOptional({ example: 'PIX' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(50)
  formaPagamento?: string;

  @ApiPropertyOptional({ description: 'Quando foi paga (padrão: agora)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  pagoEm?: Date;
}

export class ExcluirDespesaDto {
  @ApiProperty({ description: 'Motivo da exclusão (obrigatório; a exclusão é lógica)' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo da exclusão' })
  @MaxLength(500)
  motivo: string;
}

export class FiltroDespesasDto {
  @ApiPropertyOptional({ example: '2026-12-01', description: 'Data da despesa a partir de' })
  @IsOptional()
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  de?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Data da despesa até' })
  @IsOptional()
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  ate?: string;

  @ApiPropertyOptional({ enum: StatusDespesa })
  @IsOptional()
  @IsEnum(StatusDespesa)
  status?: StatusDespesa;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  funcionarioId?: string;

  @ApiPropertyOptional({ description: 'Só contas a pagar já vencidas' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  vencidas?: boolean;

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

export class FiltroPeriodoDto {
  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  de?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  ate?: string;
}

export class FiltroAVencerDto {
  @ApiPropertyOptional({
    default: 7,
    description: 'Contas a pagar que vencem até daqui a N dias (inclui vencidas)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  dias = 7;
}

export class CategoriaDto {
  @ApiProperty({ example: 'Marketing' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da categoria' })
  @MaxLength(80)
  nome: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Categoria de salários (exige VER_SALARIOS)',
  })
  @IsOptional()
  @IsBoolean()
  ehSalario?: boolean;
}

export class AtualizarCategoriaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class RecorrenteDto extends CamposSalario {
  @ApiProperty({ example: 'Aluguel do galpão' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Descreva a despesa' })
  @MaxLength(300)
  descricao: string;

  @ApiProperty({ description: 'Valor mensal em centavos' })
  @IsInt({ message: 'O valor deve ser em centavos (número inteiro)' })
  @Min(1)
  @Max(MAX_CENTAVOS)
  valorCentavos: number;

  @ApiProperty()
  @IsUUID()
  categoriaId: string;

  @ApiProperty({ description: 'Dia do vencimento (1–31; meses curtos usam o último dia)' })
  @IsInt()
  @Min(1)
  @Max(31)
  diaVencimento: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(50)
  formaPagamento?: string;
}

export class AtualizarRecorrenteDto extends PartialType(RecorrenteDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativa?: boolean;
}
