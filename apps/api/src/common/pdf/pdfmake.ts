import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import pdfmake from 'pdfmake';

const require = createRequire(import.meta.url);
const fontes = require('pdfmake/fonts/Roboto.js') as Record<string, Record<string, string>>;
const pastaFontes = dirname(require.resolve('pdfmake/fonts/Roboto.js'));

pdfmake.setFonts(fontes);
// O servidor só lê as fontes do próprio pdfmake e nunca baixa nada da internet.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((caminho: string) => caminho.startsWith(pastaFontes));

/** pdfmake já configurado para o servidor (fontes locais, sem acesso à rede). */
export { pdfmake };

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** Centavos → "R$ 1.234,56" (formatação só na saída). */
export const reais = (centavos: number) => moeda.format(centavos / 100);
