import { ForbiddenException } from '@nestjs/common';
import { verificarAcesso } from '../common/auth/acesso.guard.js';
import type { AtorPlataforma, AtorUsuario } from '../common/contexto/contexto.js';
import { localParaUtc } from '../common/utils/datas.js';
import { exigirPermissoesConcediveis } from './admins.service.js';
import { ehExclusao, naMadrugada } from './alertas.service.js';
import { gerarSenhaTemporaria, podeVerValores } from './regras.js';

const admin = (o: Partial<AtorPlataforma> = {}): AtorPlataforma => ({
  tipo: 'PLATAFORMA',
  id: 'a',
  nome: 'A',
  email: 'a@x',
  isOwner: false,
  permissoes: [],
  ...o,
});

describe('regras da plataforma', () => {
  it('valores só para o dono ou FINANCEIRO', () => {
    expect(podeVerValores(admin({ isOwner: true }))).toBe(true);
    expect(podeVerValores(admin({ permissoes: ['FINANCEIRO'] }))).toBe(true);
    expect(
      podeVerValores(admin({ permissoes: ['GESTAO_OFICINAS', 'SUPORTE', 'GESTAO_ADMINS'] })),
    ).toBe(false);
  });

  it('só concede ou retira permissões que tem; o dono concede todas', () => {
    const gestor = admin({ permissoes: ['GESTAO_ADMINS', 'SUPORTE'] });
    expect(() => exigirPermissoesConcediveis(gestor, ['SUPORTE'])).not.toThrow();
    expect(() => exigirPermissoesConcediveis(gestor, ['FINANCEIRO'])).toThrow(ForbiddenException);
    expect(() =>
      exigirPermissoesConcediveis(admin({ isOwner: true }), ['FINANCEIRO']),
    ).not.toThrow();
  });

  it('senha temporária: 12 caracteres com letra, número e símbolo, sem ambíguos', () => {
    for (let i = 0; i < 200; i++) {
      const s = gerarSenhaTemporaria();
      expect(s).toHaveLength(12);
      expect(s).toMatch(/[A-Za-z]/);
      expect(s).toMatch(/[2-9]/);
      expect(s).toMatch(/[!@#$%*]/);
      expect(s).not.toMatch(/[0O1lI]/);
    }
  });

  it('alertas: o que é exclusão e o que é madrugada (horário de Brasília)', () => {
    expect(ehExclusao('DESPESA_EXCLUIDA')).toBe(true);
    expect(ehExclusao('ESTOQUE_PECA_DESATIVADA')).toBe(true);
    expect(ehExclusao('OS_ITEM_REMOVIDO')).toBe(true);
    expect(ehExclusao('DESPESA_LANCADA')).toBe(false);
    expect(naMadrugada(localParaUtc('2026-12-01', 3 * 60))).toBe(true);
    expect(naMadrugada(localParaUtc('2026-12-01', 5 * 60))).toBe(false);
    expect(naMadrugada(localParaUtc('2026-12-01', 23 * 60))).toBe(false);
  });
});

describe('modo suporte no controle de acesso', () => {
  const suporte: AtorUsuario = {
    tipo: 'SUPORTE',
    id: 'adm',
    nome: 'Suporte Box Certo (A)',
    email: 'a@x',
    oficinaId: 'of',
    role: 'MASTER',
    permissoes: [],
  };

  it('entra nas rotas da oficina como MASTER', () => {
    expect(() =>
      verificarAcesso(suporte, {
        atores: ['USUARIO'],
        roles: ['MASTER'],
        permissoesOficina: ['FINANCEIRO'],
      }),
    ).not.toThrow();
  });

  it('não entra nas rotas da plataforma nem do cliente', () => {
    expect(() => verificarAcesso(suporte, { atores: ['PLATAFORMA'] })).toThrow(ForbiddenException);
    expect(() => verificarAcesso(suporte, { atores: ['CLIENTE'] })).toThrow(ForbiddenException);
  });
});
