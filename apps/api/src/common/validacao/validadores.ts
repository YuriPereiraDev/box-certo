import { Transform } from 'class-transformer';
import { Matches, registerDecorator, type ValidationOptions } from 'class-validator';
import { cpfValido, somenteDigitos } from '../utils/cpf.js';
import { documentoValido, normalizarPlaca, placaValida } from '../utils/documentos.js';

function validador(
  nome: string,
  teste: (valor: unknown) => boolean,
  mensagem: string,
  opcoes?: ValidationOptions,
) {
  return (alvo: object, propriedade: string) =>
    registerDecorator({
      name: nome,
      target: alvo.constructor,
      propertyName: propriedade,
      options: { message: mensagem, ...opcoes },
      validator: { validate: teste },
    });
}

/** Remove espaços extras de strings. */
export const Aparar = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** Mantém só os dígitos (CPF, CNPJ, telefone, CEP). */
export const SoDigitos = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? somenteDigitos(value) : value,
  );

export const Minusculas = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export const IsCpf = (o?: ValidationOptions) =>
  validador('isCpf', (v) => typeof v === 'string' && cpfValido(v), 'CPF inválido', o);

export const IsCpfOuCnpj = (o?: ValidationOptions) =>
  validador(
    'isCpfOuCnpj',
    (v) => typeof v === 'string' && documentoValido(v),
    'CPF ou CNPJ inválido',
    o,
  );

export const IsTelefone = (o?: ValidationOptions) =>
  validador(
    'isTelefone',
    (v) => typeof v === 'string' && /^\d{10,11}$/.test(v),
    'Telefone inválido (DDD + número)',
    o,
  );

export const IsCep = (o?: ValidationOptions) =>
  validador('isCep', (v) => typeof v === 'string' && /^\d{8}$/.test(v), 'CEP inválido', o);

export const IsUf = (o?: ValidationOptions) =>
  validador(
    'isUf',
    (v) =>
      typeof v === 'string' &&
      /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(
        v,
      ),
    'UF inválida',
    o,
  );

/** Placa antiga ou Mercosul; normaliza para maiúsculas sem hífen. */
export const Placa = () => (alvo: object, propriedade: string) => {
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarPlaca(value) : value,
  )(alvo, propriedade);
  validador(
    'isPlaca',
    (v) => typeof v === 'string' && placaValida(v),
    'Placa inválida',
  )(alvo, propriedade);
};

export const IsHora = (o?: ValidationOptions) =>
  Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Horário inválido (use HH:MM)', ...o });

/** Senha de usuário/cliente: 8 a 128 caracteres. */
export const SENHA_MIN = 8;
export const SENHA_MAX = 128;
