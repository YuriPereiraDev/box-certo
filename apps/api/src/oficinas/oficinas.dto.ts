import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
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
import { EnderecoOpcionalDto } from '../common/validacao/endereco.dto.js';
import {
  Aparar,
  IsCpfOuCnpj,
  IsHora,
  IsTelefone,
  Minusculas,
  SENHA_MAX,
  SENHA_MIN,
  SoDigitos,
} from '../common/validacao/validadores.js';

export class DadosOficinaDto extends EnderecoOpcionalDto {
  @ApiProperty({ example: 'Auto Center Silva' })
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da oficina' })
  @MaxLength(150)
  nome: string;

  @ApiPropertyOptional({ description: 'CPF ou CNPJ' })
  @IsOptional()
  @SoDigitos()
  @IsCpfOuCnpj()
  documento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @SoDigitos()
  @IsTelefone()
  telefone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Minusculas()
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(200)
  email?: string;
}

export class AtualizarOficinaDto extends DadosOficinaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  declare nome: string;
}

export class MasterCadastroDto {
  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe seu nome' })
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

  @ApiProperty({ minLength: SENHA_MIN })
  @IsString()
  @MinLength(SENHA_MIN, { message: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres` })
  @MaxLength(SENHA_MAX)
  senha: string;
}

/** Autocadastro público: cria a oficina (TESTE por 14 dias) e o usuário MASTER. */
export class CadastroOficinaDto {
  @ApiProperty({ type: DadosOficinaDto })
  @ValidateNested()
  @Type(() => DadosOficinaDto)
  oficina: DadosOficinaDto;

  @ApiProperty({ type: MasterCadastroDto })
  @ValidateNested()
  @Type(() => MasterCadastroDto)
  master: MasterCadastroDto;

  @ApiProperty({ description: 'Plano escolhido (GET /publico/planos)' })
  @IsUUID()
  planoId: string;

  @ApiProperty({ description: 'Aceite dos termos de uso e da política de privacidade' })
  @IsBoolean()
  @Equals(true, { message: 'É preciso aceitar os termos de uso e a política de privacidade' })
  aceiteTermos: boolean;
}

export class ConfigDescontosDto {
  @ApiProperty({ description: 'Mecânico pode dar desconto nas próprias OS' })
  @IsBoolean()
  mecanicoPodeDarDesconto: boolean;

  @ApiPropertyOptional({ description: 'Limite em % (null = sem limite)', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  limiteDescontoPercentual?: number | null;

  @ApiPropertyOptional({ description: 'Limite em centavos (null = sem limite)', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  limiteDescontoCentavos?: number | null;

  @ApiPropertyOptional({ description: 'Motivo da alteração (vai para a auditoria)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class ConfigAgendamentoDto {
  @ApiProperty({ description: 'Cliente pode reagendar/cancelar até X horas antes', default: 2 })
  @IsInt()
  @Min(0)
  @Max(168)
  antecedenciaCancelamentoHoras: number;
}

export class HorarioDiaDto {
  @ApiProperty({ description: '0 = domingo ... 6 = sábado' })
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana: number;

  @ApiProperty({ example: '08:00' })
  @IsHora()
  abre: string;

  @ApiProperty({ example: '18:00' })
  @IsHora()
  fecha: string;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @IsHora()
  intervaloInicio?: string;

  @ApiPropertyOptional({ example: '13:00' })
  @ValidateIf((o: HorarioDiaDto) => o.intervaloInicio !== undefined)
  @IsHora({ message: 'Informe o fim do intervalo (HH:MM)' })
  intervaloFim?: string;
}

export class HorariosDto {
  @ApiProperty({
    type: [HorarioDiaDto],
    description: 'Dias em que a oficina abre. Dias que não vierem na lista ficam fechados.',
  })
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => HorarioDiaDto)
  dias: HorarioDiaDto[];
}
