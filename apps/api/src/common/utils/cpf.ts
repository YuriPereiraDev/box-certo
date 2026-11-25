/** Remove tudo que não for dígito. */
export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

/** Valida CPF pelos dígitos verificadores. Aceita com ou sem máscara. */
export function cpfValido(valor: string): boolean {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (base: string, pesoInicial: number) => {
    const soma = [...base].reduce((acc, d, i) => acc + Number(d) * (pesoInicial - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = digito(cpf.slice(0, 9), 10);
  const d2 = digito(cpf.slice(0, 10), 11);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

/** Gera um CPF válido aleatório (para seed e testes). */
export function gerarCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
  if (/^(\d)\1{8}$/.test(base)) return gerarCpf();
  const digito = (b: string, peso: number) => {
    const soma = [...b].reduce((acc, d, i) => acc + Number(d) * (peso - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = digito(base, 10);
  const d2 = digito(base + d1, 11);
  return `${base}${d1}${d2}`;
}
