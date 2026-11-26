import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Aparar, IsTelefone, Minusculas, SoDigitos } from '../common/validacao/validadores.js';
import { OficinaStatus, PermissaoPlataforma } from '../generated/prisma/enums.js';
import { DadosOficinaDto } from '../oficinas/oficinas.dto.js';

// ------------------------------------------------------------------ admins

export class CriarAdminDto {
  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome: string;

  @ApiProperty()
  @Minusculas()
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(200)
  email: string;

  @ApiProperty({
    enum: PermissaoPlataforma,
    isArray: true,
    description: 'Só pode conceder as que você tem',
  })
  @IsArray()
  @ArrayUnique()
  @IsEnum(PermissaoPlataforma, { each: true })
  permissoes: PermissaoPlataforma[];
}

export class AtualizarAdminDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome?: string;

  @ApiPropertyOptional({ enum: PermissaoPlataforma, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PermissaoPlataforma, { each: true })
  permissoes?: PermissaoPlataforma[];
}

export class StatusContaDto {
  @ApiProperty({ description: 'false bloqueia (encerra as sessões); true libera' })
  @IsBoolean()
  ativo: boolean;

  @ApiPropertyOptional({ description: 'Motivo (vai para a auditoria)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

// ------------------------------------------------------------------ oficinas

export class FiltroOficinasDto {
  @ApiPropertyOptional({ description: 'Busca por nome, documento, e-mail ou cidade' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: OficinaStatus })
  @IsOptional()
  @IsEnum(OficinaStatus)
  status?: OficinaStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planoId?: string;

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

export class MasterAdminDto {
  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome: string;

  @ApiProperty()
  @Minusculas()
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(200)
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @SoDigitos()
  @IsTelefone()
  telefone?: string;
}

export class CriarOficinaPlataformaDto {
  @ApiProperty({ type: DadosOficinaDto })
  @ValidateNested()
  @Type(() => DadosOficinaDto)
  oficina: DadosOficinaDto;

  @ApiProperty({ type: MasterAdminDto, description: 'O master recebe uma senha temporária' })
  @ValidateNested()
  @Type(() => MasterAdminDto)
  master: MasterAdminDto;

  @ApiProperty()
  @IsUUID()
  planoId: string;
}

export class StatusOficinaDto {
  @ApiProperty({ enum: ['ATIVA', 'SUSPENSA', 'CANCELADA'], description: 'ATIVA também reativa' })
  @IsIn(['ATIVA', 'SUSPENSA', 'CANCELADA'])
  status: 'ATIVA' | 'SUSPENSA' | 'CANCELADA';

  @ApiProperty({ description: 'Motivo (obrigatório; vai para a auditoria)' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo' })
  @MaxLength(500)
  motivo: string;
}

export class TrocarPlanoDto {
  @ApiProperty()
  @IsUUID()
  planoId: string;
}

export class EstenderTesteDto {
  @ApiProperty({ description: 'Dias a mais de teste' })
  @IsInt()
  @Min(1)
  @Max(90)
  dias: number;
}

export class PrecoFundadorDto {
  @ApiProperty({ nullable: true, description: 'Mensalidade travada em centavos (null remove)' })
  @ValidateIf((o: PrecoFundadorDto) => o.precoFundadorCentavos !== null)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  precoFundadorCentavos: number | null;
}

// ------------------------------------------------------------------ planos

export class PlanoDto {
  @ApiProperty({ example: 'Oficina' })
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nome: string;

  @ApiProperty({ description: 'Mensalidade em centavos' })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  precoCentavos: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Máximo de mecânicos ativos (null = ilimitado)',
  })
  @IsOptional()
  @ValidateIf((o: PlanoDto) => o.maxMecanicos !== null)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxMecanicos?: number | null;
}

export class AtualizarPlanoDto extends PartialType(PlanoDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

// ------------------------------------------------------------------ usuários

export class BuscaContasDto {
  @ApiProperty({ description: 'Nome, e-mail ou CPF (mínimo 3 caracteres)' })
  @IsString()
  @MinLength(3, { message: 'Digite pelo menos 3 caracteres' })
  @MaxLength(100)
  q: string;
}

// ------------------------------------------------------------------ avisos

export class AvisoDto {
  @ApiProperty({ example: 'Manutenção programada' })
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  titulo: string;

  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  mensagem: string;

  @ApiPropertyOptional({ description: 'Começa a aparecer em (padrão: agora)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  inicio?: Date;

  @ApiPropertyOptional({ description: 'Deixa de aparecer em (vazio = até desativar)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fim?: Date;
}

export class AtualizarAvisoDto extends PartialType(AvisoDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

// ------------------------------------------------------------------ suporte

export class AbrirSuporteDto {
  @ApiProperty()
  @IsUUID()
  oficinaId: string;

  @ApiProperty({ description: 'Por que o suporte vai entrar (ex.: ticket #123)' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo do acesso' })
  @MaxLength(500)
  motivo: string;

  @ApiPropertyOptional({ default: 60, description: 'Duração em minutos (15 a 120)' })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(120)
  duracaoMin?: number;
}

// ------------------------------------------------------------------ logs

export class FiltroAlertasDto {
  @ApiPropertyOptional({ default: 24, description: 'Janela em horas' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  horas = 24;
}
