import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PermissaoOficina } from '../generated/prisma/enums.js';
import {
  Aparar,
  IsTelefone,
  Minusculas,
  SENHA_MAX,
  SENHA_MIN,
  SoDigitos,
} from '../common/validacao/validadores.js';

/** Perfis que o master pode atribuir (MASTER só existe pelo cadastro da oficina). */
export const ROLES_ATRIBUIVEIS = ['MECANICO', 'FINANCEIRO'] as const;
export type RoleAtribuivel = (typeof ROLES_ATRIBUIVEIS)[number];

class ComMotivo {
  @ApiPropertyOptional({ description: 'Motivo (fica registrado na auditoria)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class CriarUsuarioDto extends ComMotivo {
  @ApiProperty()
  @Aparar()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome' })
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

  @ApiProperty({ enum: ROLES_ATRIBUIVEIS })
  @IsIn(ROLES_ATRIBUIVEIS, { message: 'Perfil deve ser MECANICO ou FINANCEIRO' })
  role: RoleAtribuivel;

  @ApiPropertyOptional({ enum: PermissaoOficina, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PermissaoOficina, { each: true })
  permissoes?: PermissaoOficina[];

  @ApiProperty({
    description: 'Senha inicial (o usuário pode trocar depois)',
    minLength: SENHA_MIN,
  })
  @IsString()
  @MinLength(SENHA_MIN, { message: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres` })
  @MaxLength(SENHA_MAX)
  senha: string;
}

export class AtualizarUsuarioDto extends ComMotivo {
  @ApiPropertyOptional()
  @IsOptional()
  @Aparar()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @SoDigitos()
  @IsTelefone()
  telefone?: string;

  @ApiPropertyOptional({ enum: ROLES_ATRIBUIVEIS })
  @IsOptional()
  @IsIn(ROLES_ATRIBUIVEIS, { message: 'Perfil deve ser MECANICO ou FINANCEIRO' })
  role?: RoleAtribuivel;
}

export class PermissoesUsuarioDto extends ComMotivo {
  @ApiProperty({ enum: PermissaoOficina, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(PermissaoOficina, { each: true })
  permissoes: PermissaoOficina[];
}

export class StatusUsuarioDto extends ComMotivo {
  @ApiProperty()
  @IsBoolean()
  ativo: boolean;
}

export class RedefinirSenhaDto extends ComMotivo {
  @ApiProperty({ minLength: SENHA_MIN })
  @IsString()
  @MinLength(SENHA_MIN, { message: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres` })
  @MaxLength(SENHA_MAX)
  novaSenha: string;
}
