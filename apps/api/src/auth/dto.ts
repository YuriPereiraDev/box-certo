import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export class LoginOficinaDto {
  @ApiProperty({ example: 'master@oficina.com' })
  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(200)
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Informe a senha' })
  @MaxLength(200)
  senha: string;

  @ApiPropertyOptional({
    description: 'Obrigatório só quando o mesmo e-mail e senha existem em mais de uma oficina',
  })
  @IsOptional()
  @IsUUID()
  oficinaId?: string;
}

export class LoginClienteDto {
  @ApiProperty({ description: 'E-mail ou CPF', example: 'cliente@email.com' })
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

export class LoginPlataformaDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(200)
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Informe a senha' })
  @MaxLength(200)
  senha: string;

  @ApiPropertyOptional({ description: 'Código de 6 dígitos do app autenticador' })
  @IsOptional()
  @IsString()
  @Length(6, 6, { message: 'O código tem 6 dígitos' })
  codigoTotp?: string;
}

export class Config2faDto {
  @ApiProperty({ description: 'Token devolvido pelo login quando o 2FA ainda não foi configurado' })
  @IsString()
  @IsNotEmpty()
  tokenConfiguracao: string;
}

export class Ativar2faDto extends Config2faDto {
  @ApiProperty({ description: 'Código de 6 dígitos do app autenticador' })
  @IsString()
  @Length(6, 6, { message: 'O código tem 6 dígitos' })
  codigo: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  refreshToken: string;
}

export class TrocarSenhaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Informe a senha atual' })
  @MaxLength(200)
  senhaAtual: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @Length(8, 128, { message: 'A nova senha precisa ter de 8 a 128 caracteres' })
  novaSenha: string;
}
