import { ForbiddenException } from '@nestjs/common';
import type { AtorPlataforma, AtorUsuario } from '../contexto/contexto.js';
import { verificarAcesso } from './acesso.guard.js';

const usuario = (over: Partial<AtorUsuario> = {}): AtorUsuario => ({
  tipo: 'USUARIO',
  id: 'u',
  nome: 'U',
  email: 'u@x',
  oficinaId: 'o',
  role: 'MECANICO',
  permissoes: [],
  ...over,
});

const admin = (over: Partial<AtorPlataforma> = {}): AtorPlataforma => ({
  tipo: 'PLATAFORMA',
  id: 'a',
  nome: 'A',
  email: 'a@x',
  isOwner: false,
  permissoes: [],
  ...over,
});

describe('verificarAcesso', () => {
  it('nega rota sem @Atores (fail closed)', () => {
    expect(() => verificarAcesso(usuario({ role: 'MASTER' }), {})).toThrow(ForbiddenException);
  });

  it('nega tipo de conta não listado', () => {
    expect(() => verificarAcesso(admin({ isOwner: true }), { atores: ['USUARIO'] })).toThrow(
      ForbiddenException,
    );
  });

  it('MASTER passa em qualquer perfil e permissão da oficina', () => {
    expect(() =>
      verificarAcesso(usuario({ role: 'MASTER' }), {
        atores: ['USUARIO'],
        roles: ['FINANCEIRO'],
        permissoesOficina: ['FINANCEIRO', 'VER_SALARIOS'],
      }),
    ).not.toThrow();
  });

  it('exige todas as permissões listadas', () => {
    const regras = {
      atores: ['USUARIO' as const],
      permissoesOficina: ['FINANCEIRO' as const, 'VER_SALARIOS' as const],
    };
    expect(() => verificarAcesso(usuario({ permissoes: ['FINANCEIRO'] }), regras)).toThrow();
    expect(() =>
      verificarAcesso(usuario({ permissoes: ['FINANCEIRO', 'VER_SALARIOS'] }), regras),
    ).not.toThrow();
  });

  it('confere o perfil quando @ExigeRole é usado', () => {
    expect(() => verificarAcesso(usuario(), { atores: ['USUARIO'], roles: ['MASTER'] })).toThrow();
  });

  it('dono da plataforma passa em tudo; admin comum precisa da permissão', () => {
    const regras = {
      atores: ['PLATAFORMA' as const],
      permissoesPlataforma: ['FINANCEIRO' as const],
    };
    expect(() => verificarAcesso(admin({ isOwner: true }), regras)).not.toThrow();
    expect(() => verificarAcesso(admin(), regras)).toThrow();
    expect(() => verificarAcesso(admin({ permissoes: ['FINANCEIRO'] }), regras)).not.toThrow();
  });
});
