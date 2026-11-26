import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

const DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class FiltroDashboardDto {
  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Início do período (padrão: 1º do mês atual)',
  })
  @IsOptional()
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  de?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Fim do período (padrão: hoje)' })
  @IsOptional()
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  ate?: string;

  @ApiPropertyOptional({
    description: 'Só os números deste mecânico (o bloco financeiro é sempre da oficina)',
  })
  @IsOptional()
  @IsUUID()
  mecanicoId?: string;
}

export class ExportarDashboardDto extends FiltroDashboardDto {
  @ApiPropertyOptional({ enum: ['pdf', 'xlsx'], default: 'pdf' })
  @IsOptional()
  @IsIn(['pdf', 'xlsx'])
  formato: 'pdf' | 'xlsx' = 'pdf';
}
