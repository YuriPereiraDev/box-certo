import { cpfValido, somenteDigitos } from './cpf.js';

/** Valida CNPJ pelos dígitos verificadores. Aceita com ou sem máscara. */
export function cnpjValido(valor: string): boolean {
  const cnpj = somenteDigitos(valor);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digito = (base: string) => {
    const pesos =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = digito(cnpj.slice(0, 12));
  const d2 = digito(cnpj.slice(0, 13));
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

/** CPF (11 dígitos) ou CNPJ (14 dígitos) válido. */
export function documentoValido(valor: string): boolean {
  const d = somenteDigitos(valor);
  return d.length === 11 ? cpfValido(d) : d.length === 14 ? cnpjValido(d) : false;
}

/** Placa antiga (ABC1234) ou Mercosul (ABC1D23), normalizada sem hífen e em maiúsculas. */
export function normalizarPlaca(valor: string): string {
  return valor.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function placaValida(valor: string): boolean {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(normalizarPlaca(valor));
}

/** "HH:MM" → minutos desde 00:00. */
export function horaParaMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}
