import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { EnderecoOpcionalDto } from '../common/validacao/endereco.dto.js';
import { Aparar, IsTelefone, SoDigitos } from '../common/validacao/validadores.js';

export class FiltroClientesDto {
  @ApiPropertyOptional({ description: 'Busca por nome, CPF, e-mail ou telefone' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ObservacoesClienteDto {
  @ApiPropertyOptional({ description: 'Anotações internas (o cliente não vê)', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  observacoesInternas?: string | null;
}

/** O cliente pode alterar nome, telefone e endereço. CPF e e-mail não mudam por aqui. */
export class AtualizarPerfilClienteDto extends EnderecoOpcionalDto {
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
}
