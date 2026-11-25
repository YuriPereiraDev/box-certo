import { BadRequestException } from '@nestjs/common';
import { HORARIOS_PADRAO, validarHorarioDia } from './oficinas.service.js';

describe('validarHorarioDia', () => {
  it('aceita expediente com e sem intervalo', () => {
    expect(() =>
      validarHorarioDia({
        diaSemana: 1,
        abre: '08:00',
        fecha: '18:00',
        intervaloInicio: '12:00',
        intervaloFim: '13:00',
      }),
    ).not.toThrow();
    expect(() => validarHorarioDia({ diaSemana: 6, abre: '08:00', fecha: '12:00' })).not.toThrow();
  });

  it.each([
    [{ diaSemana: 1, abre: '18:00', fecha: '08:00' }, /abertura/],
    [{ diaSemana: 1, abre: '08:00', fecha: '08:00' }, /abertura/],
    [{ diaSemana: 2, abre: '08:00', fecha: '18:00', intervaloInicio: '12:00' }, /início e fim/],
    [
      {
        diaSemana: 3,
        abre: '08:00',
        fecha: '18:00',
        intervaloInicio: '07:00',
        intervaloFim: '09:00',
      },
      /dentro/,
    ],
    [
      {
        diaSemana: 4,
        abre: '08:00',
        fecha: '18:00',
        intervaloInicio: '13:00',
        intervaloFim: '12:00',
      },
      /dentro/,
    ],
  ])('recusa %o', (dia, msg) => {
    expect(() => validarHorarioDia(dia)).toThrow(BadRequestException);
    expect(() => validarHorarioDia(dia)).toThrow(msg);
  });

  it('o horário padrão de oficina nova é válido', () => {
    for (const d of HORARIOS_PADRAO) expect(() => validarHorarioDia(d)).not.toThrow();
  });
});
