import { transicaoPermitida } from './agendamentos.service.js';

describe('transições de status do agendamento', () => {
  it('fluxo normal', () => {
    expect(transicaoPermitida('AGENDADO', 'CONFIRMADO')).toBe(true);
    expect(transicaoPermitida('CONFIRMADO', 'EM_ATENDIMENTO')).toBe(true);
    expect(transicaoPermitida('EM_ATENDIMENTO', 'CONCLUIDO')).toBe(true);
    expect(transicaoPermitida('AGENDADO', 'NAO_COMPARECEU')).toBe(true);
  });

  it('estados finais não mudam e não se volta atrás', () => {
    for (const final of ['CONCLUIDO', 'CANCELADO', 'NAO_COMPARECEU'] as const) {
      expect(transicaoPermitida(final, 'CONFIRMADO')).toBe(false);
      expect(transicaoPermitida(final, 'CANCELADO')).toBe(false);
    }
    expect(transicaoPermitida('EM_ATENDIMENTO', 'CONFIRMADO')).toBe(false);
    expect(transicaoPermitida('EM_ATENDIMENTO', 'NAO_COMPARECEU')).toBe(false);
  });
});
