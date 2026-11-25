import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDate,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxDate,
  MaxLength,
  Min,
  MinDate,
  MinLength,
} from 'class-validator';
import {
  Aparar,
  IsCep,
  IsCpf,
  IsTelefone,
  IsUf,
  Minusculas,
  SENHA_MAX,
  SENHA_MIN,
  SoDigitos,
} from '../common/validacao/validadores.js';

export class CriarConviteDto {
  @ApiPropertyOptional({
    description: 'Individual: para um cliente específico (1 uso, vale 7 dias por padrão)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  individual?: boolean;

  @ApiPropertyOptional({ description: 'Nome do cliente (pré-preenche o cadastro)' })
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(150)
  nome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @SoDigitos()
  @IsTelefone()
  telefone?: string;

  @ApiPropertyOptional({ description: 'Data de expiração (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date(), { message: 'A expiração precisa ser no futuro' })
  expiraEm?: Date;

  @ApiPropertyOptional({ description: 'Máximo de usos (vazio = ilimitado; individual = 1)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxUsos?: number;
}

/** Cadastro do cliente pelo link de convite (seção 7.1). */
export class CadastroClienteDto {
  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe seu nome' })
  @MaxLength(150)
  nome: string;

  @ApiProperty({ example: '529.982.247-25' })
  @SoDigitos()
  @IsCpf()
  cpf: string;

  @ApiProperty({ example: '1990-05-20' })
  @Type(() => Date)
  @IsDate({ message: 'Data de nascimento inválida' })
  @MaxDate(() => new Date(), { message: 'Data de nascimento inválida' })
  @MinDate(new Date('1900-01-01'), { message: 'Data de nascimento inválida' })
  dataNascimento: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(20)
  rg?: string;

  @ApiProperty()
  @Minusculas()
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(200)
  email: string;

  @ApiProperty()
  @SoDigitos()
  @IsTelefone()
  telefone: string;

  @ApiProperty()
  @SoDigitos()
  @IsCep()
  cep: string;

  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe a rua' })
  @MaxLength(200)
  rua: string;

  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o número' })
  @MaxLength(20)
  numero: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @MaxLength(100)
  complemento?: string;

  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o bairro' })
  @MaxLength(100)
  bairro: string;

  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe a cidade' })
  @MaxLength(100)
  cidade: string;

  @ApiProperty({ example: 'SP' })
  @Aparar()
  @IsUf()
  uf: string;

  @ApiProperty({ minLength: SENHA_MIN })
  @IsString()
  @MinLength(SENHA_MIN, { message: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres` })
  @MaxLength(SENHA_MAX)
  senha: string;

  @ApiProperty({ description: 'Consentimento LGPD (termos de uso e política de privacidade)' })
  @IsBoolean()
  @Equals(true, { message: 'É preciso aceitar os termos de uso e a política de privacidade' })
  aceiteLgpd: boolean;
}

export class VincularClienteDto {
  @ApiProperty({ description: 'E-mail ou CPF' })
  @IsString()
  @IsNotEmpty({ message: 'Informe o e-mail ou CPF' })
  @MaxLength(200)
  login: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Informe a senha' })
  @MaxLength(200)
  senha: string;
}
