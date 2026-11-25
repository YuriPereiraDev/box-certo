import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Aparar } from '../common/validacao/validadores.js';
import { StatusAgendamento } from '../generated/prisma/enums.js';

const DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class FiltroDisponibilidadeDto {
  @ApiProperty({ example: '2026-12-01', description: 'Dia (horário de Brasília)' })
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  data: string;

  @ApiPropertyOptional({ default: 1, maximum: 14, description: 'Quantos dias a partir de `data`' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(14)
  dias = 1;
}

export class FiltroDisponibilidadeOficinaDto extends FiltroDisponibilidadeDto {
  @ApiPropertyOptional({ description: 'Só horários em que este mecânico está livre' })
  @IsOptional()
  @IsUUID()
  mecanicoId?: string;

  @ApiPropertyOptional({ description: 'Duração em minutos (padrão: a da oficina)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(600)
  duracaoMin?: number;
}

class BaseAgendamentoDto {
  @ApiProperty()
  @IsUUID()
  veiculoId: string;

  @ApiProperty({ example: '2026-12-01T09:00:00-03:00', description: 'Início (ISO 8601)' })
  @Type(() => Date)
  @IsDate({ message: 'Início inválido' })
  inicio: Date;

  @ApiProperty({ example: 'Barulho no freio dianteiro', description: 'O que o cliente precisa' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Descreva o serviço' })
  @MaxLength(200)
  tipoServico: string;
}

export class CriarAgendamentoClienteDto extends BaseAgendamentoDto {
  @ApiProperty()
  @IsUUID()
  oficinaId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(1000)
  observacaoCliente?: string;
}

export class CriarAgendamentoOficinaDto extends BaseAgendamentoDto {
  @ApiProperty()
  @IsUUID()
  clienteId: string;

  @ApiPropertyOptional({ description: 'Duração em minutos (padrão: a da oficina)' })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(600)
  duracaoMin?: number;

  @ApiPropertyOptional({ description: 'Mecânico (mecânico comum só agenda para si)' })
  @IsOptional()
  @IsUUID()
  mecanicoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(1000)
  observacaoOficina?: string;
}

export class ReagendarClienteDto {
  @ApiProperty({ example: '2026-12-02T10:00:00-03:00' })
  @Type(() => Date)
  @IsDate({ message: 'Início inválido' })
  inicio: Date;
}

export class ReagendarOficinaDto extends ReagendarClienteDto {
  @ApiPropertyOptional({ description: 'Nova duração em minutos' })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(600)
  duracaoMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class CancelarDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class AtribuirMecanicoDto {
  @ApiProperty({ nullable: true, description: 'null tira o mecânico do agendamento' })
  @ValidateIf((o: AtribuirMecanicoDto) => o.mecanicoId !== null)
  @IsUUID()
  mecanicoId: string | null;
}

export const STATUS_MANUAIS = [
  'CONFIRMADO',
  'EM_ATENDIMENTO',
  'CONCLUIDO',
  'CANCELADO',
  'NAO_COMPARECEU',
] as const;

export class AlterarStatusDto {
  @ApiProperty({ enum: STATUS_MANUAIS })
  @IsIn(STATUS_MANUAIS, { message: 'Status inválido' })
  status: (typeof STATUS_MANUAIS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class FiltroAgendamentosDto {
  @ApiPropertyOptional({ example: '2026-12-01', description: 'A partir do dia (inclusive)' })
  @IsOptional()
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  de?: string;

  @ApiPropertyOptional({ example: '2026-12-07', description: 'Até o dia (inclusive)' })
  @IsOptional()
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  ate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mecanicoId?: string;

  @ApiPropertyOptional({ description: 'Só os que ainda não têm mecânico' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  semMecanico?: boolean;

  @ApiPropertyOptional({ enum: StatusAgendamento })
  @IsOptional()
  @IsEnum(StatusAgendamento)
  status?: StatusAgendamento;
}

export class FiltroAgendaDto {
  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  data: string;

  @ApiPropertyOptional({ default: 1, maximum: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dias = 1;
}

export class FiltroAgendamentosClienteDto {
  @ApiPropertyOptional({ description: 'Só os próximos (a partir de agora)', default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  futuros?: boolean;
}
