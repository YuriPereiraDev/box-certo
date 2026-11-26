import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Aparar } from '../common/validacao/validadores.js';
import { StatusTicket, TipoTicket } from '../generated/prisma/enums.js';

/** Enviado automaticamente pelo app (seção 7.7). */
export class ContextoTicketDto {
  @ApiPropertyOptional({ example: '1.4.0' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  versaoApp?: string;

  @ApiPropertyOptional({ example: 'Samsung SM-A515F' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  aparelho?: string;

  @ApiPropertyOptional({ example: 'Android 14' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sistema?: string;

  @ApiPropertyOptional({ example: '/oficina/ordens-servico/123' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rota?: string;
}

export class AbrirTicketDto {
  @ApiProperty({ enum: TipoTicket })
  @IsEnum(TipoTicket, { message: 'Tipo deve ser ERRO, SUGESTAO ou DUVIDA' })
  tipo: TipoTicket;

  @ApiProperty({ example: 'Não consigo enviar o orçamento' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe um título' })
  @MaxLength(120)
  titulo: string;

  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Descreva o que aconteceu' })
  @MaxLength(5000)
  descricao: string;

  @ApiPropertyOptional({ type: ContextoTicketDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContextoTicketDto)
  contexto?: ContextoTicketDto;
}

export class MensagemTicketDto {
  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Escreva a mensagem' })
  @MaxLength(5000)
  texto: string;
}

export class MensagemSuporteDto extends MensagemTicketDto {
  @ApiPropertyOptional({ default: false, description: 'Nota interna: o usuário não vê' })
  @IsOptional()
  @IsBoolean()
  interna?: boolean;
}

export class FiltroMeusTicketsDto {
  @ApiPropertyOptional({ enum: StatusTicket })
  @IsOptional()
  @IsEnum(StatusTicket)
  status?: StatusTicket;
}

export class FiltroFilaDto {
  @ApiPropertyOptional({ enum: StatusTicket, description: 'Padrão: todos menos RESOLVIDO' })
  @IsOptional()
  @IsEnum(StatusTicket)
  status?: StatusTicket;

  @ApiPropertyOptional({ enum: TipoTicket })
  @IsOptional()
  @IsEnum(TipoTicket)
  tipo?: TipoTicket;

  @ApiPropertyOptional({ description: 'Só os atribuídos a mim' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  meus?: boolean;

  @ApiPropertyOptional({ description: 'Busca no título, autor ou número' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

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

export class AtualizarTicketDto {
  @ApiPropertyOptional({ enum: StatusTicket })
  @IsOptional()
  @IsEnum(StatusTicket)
  status?: StatusTicket;

  @ApiPropertyOptional({ description: '0 normal, 1 alta, 2 urgente' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  prioridade?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Admin responsável (null tira)' })
  @IsOptional()
  @ValidateIf((o: AtualizarTicketDto) => o.atribuidoAId !== null)
  @IsUUID()
  atribuidoAId?: string | null;
}
