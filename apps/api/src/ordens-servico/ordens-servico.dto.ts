import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Aparar } from '../common/validacao/validadores.js';
import { OrigemPeca, StatusOS, TipoDesconto, TipoItem } from '../generated/prisma/enums.js';

export class DadosVerificacaoDto {
  @ApiPropertyOptional({ description: 'Km na entrada' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5_000_000)
  kmEntrada?: number;

  @ApiPropertyOptional({ example: '1/2 tanque' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(50)
  combustivel?: string;

  @ApiPropertyOptional({ description: 'Estado do veículo na entrada (riscos, amassados...)' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(2000)
  estadoVeiculo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(5000)
  diagnostico?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(5000)
  observacoes?: string;
}

export class AbrirOsDto extends DadosVerificacaoDto {
  @ApiPropertyOptional({
    description: 'Abre a partir de um agendamento (cliente e veículo vêm dele)',
  })
  @IsOptional()
  @IsUUID()
  agendamentoId?: string;

  @ApiPropertyOptional({ description: 'Balcão: cliente vinculado à oficina' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'Balcão: veículo do cliente' })
  @IsOptional()
  @IsUUID()
  veiculoId?: string;

  @ApiPropertyOptional({
    description: 'Mecânico responsável (padrão: o do agendamento ou quem abre)',
  })
  @IsOptional()
  @IsUUID()
  mecanicoId?: string;
}

export class ItemOrcamentoDto {
  @ApiPropertyOptional({
    description: 'Item da tabela de preços (preenche descrição, tipo e preço)',
  })
  @IsOptional()
  @IsUUID()
  tabelaPrecoId?: string;

  @ApiPropertyOptional({ example: 'Pastilha de freio dianteira' })
  @IsOptional()
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  descricao?: string;

  @ApiPropertyOptional({ enum: TipoItem })
  @IsOptional()
  @IsEnum(TipoItem)
  tipo?: TipoItem;

  @ApiPropertyOptional({
    enum: OrigemPeca,
    description:
      'Obrigatória para peças. ESTOQUE fica disponível com o módulo de estoque (fase 5).',
  })
  @IsOptional()
  @IsEnum(OrigemPeca)
  origemPeca?: OrigemPeca;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantidade?: number;

  @ApiPropertyOptional({ description: 'Preço unitário em centavos (editável neste orçamento)' })
  @IsOptional()
  @IsInt({ message: 'O preço deve ser em centavos (número inteiro)' })
  @Min(0)
  @Max(100_000_000)
  precoUnitarioCentavos?: number;

  @ApiPropertyOptional({ description: 'Custo unitário em centavos (só MASTER ou FINANCEIRO)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  custoUnitarioCentavos?: number;

  @ApiPropertyOptional({ description: 'Link de afiliado (botão "Comprar peça" no app do cliente)' })
  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true }, { message: 'Link inválido' })
  @MaxLength(2000)
  linkAfiliado?: string;
}

export class AtualizarItemDto extends PartialType(ItemOrcamentoDto) {}

export class DescontoDto {
  @ApiProperty({ enum: TipoDesconto })
  @IsEnum(TipoDesconto)
  tipo: TipoDesconto;

  @ApiProperty({ description: 'PERCENTUAL: % inteiro (1–100). VALOR: centavos.' })
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  valor: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class DecisaoDescontoDto {
  @ApiProperty({ description: 'true aprova, false recusa' })
  @IsBoolean()
  aprovar: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class TrocarMecanicoDto {
  @ApiProperty()
  @IsUUID()
  mecanicoId: string;
}

export class PagamentoDto {
  @ApiProperty({ example: 'PIX', description: 'Forma de pagamento recebida na oficina' })
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  formaPagamento: string;
}

export class ConcluirOsDto {
  @ApiPropertyOptional({ description: 'Se informado, já registra o pagamento na oficina' })
  @IsOptional()
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  formaPagamento?: string;
}

export class CancelarOsDto {
  @ApiProperty({ description: 'Motivo do cancelamento (vai para a auditoria)' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo do cancelamento' })
  @MaxLength(500)
  motivo: string;
}

export class CancelarOsClienteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class RespostaItemDto {
  @ApiProperty()
  @IsUUID()
  itemId: string;

  @ApiProperty()
  @IsBoolean()
  aprovado: boolean;

  @ApiPropertyOptional({
    description: 'Ao recusar uma peça: o cliente vai trazer a peça; entra um item no lugar dela',
  })
  @IsOptional()
  @IsBoolean()
  vouTrazerAPeca?: boolean;
}

export class RespostasDto {
  @ApiProperty({ type: [RespostaItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RespostaItemDto)
  respostas: RespostaItemDto[];
}

const DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class FiltroOsDto {
  @ApiPropertyOptional({ enum: StatusOS })
  @IsOptional()
  @IsEnum(StatusOS)
  status?: StatusOS;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  veiculoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mecanicoId?: string;

  @ApiPropertyOptional({ example: '2026-12-01', description: 'Abertas a partir do dia' })
  @IsOptional()
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  de?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Abertas até o dia' })
  @IsOptional()
  @Matches(DATA, { message: 'Data inválida (use AAAA-MM-DD)' })
  ate?: string;
}
