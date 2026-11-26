import { detectarImagem, detectarVideo } from '../arquivos/arquivos.service.js';
import type { AtorCliente, AtorUsuario } from '../common/contexto/contexto.js';
import { podeVerTicket, statusAposMensagemDoUsuario } from './tickets.service.js';

const ftyp = (marca: string) =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${marca}`), Buffer.alloc(16)]);

describe('detecção de vídeo pelos bytes', () => {
  it('MP4, MOV, 3GP e WEBM', () => {
    expect(detectarVideo(ftyp('isom'))?.mime).toBe('video/mp4');
    expect(detectarVideo(ftyp('mp42'))?.mime).toBe('video/mp4');
    expect(detectarVideo(ftyp('qt  '))?.mime).toBe('video/quicktime');
    expect(detectarVideo(ftyp('3gp5'))?.mime).toBe('video/3gpp');
    expect(
      detectarVideo(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]))?.mime,
    ).toBe('video/webm');
  });

  it('HEIC é imagem, não vídeo; texto não é nada', () => {
    expect(detectarVideo(ftyp('heic'))).toBeNull();
    expect(detectarImagem(ftyp('heic'))?.mime).toBe('image/heic');
    expect(detectarVideo(Buffer.from('apenas um texto qualquer aqui'))).toBeNull();
  });
});

describe('regras de tickets', () => {
  const usuario = (o: Partial<AtorUsuario>) =>
    ({
      tipo: 'USUARIO',
      id: 'u1',
      nome: 'U',
      email: 'u@x',
      oficinaId: 'of1',
      role: 'MECANICO',
      permissoes: [],
      ...o,
    }) as AtorUsuario & { tipo: 'USUARIO' };
  const cliente: AtorCliente = { tipo: 'CLIENTE', id: 'c1', nome: 'C', email: 'c@x' };
  const ticket = { autorTipo: 'USUARIO' as const, autorId: 'u1', oficinaId: 'of1' };

  it('vê quem abriu e o master da mesma oficina', () => {
    expect(podeVerTicket(usuario({}), ticket)).toBe(true);
    expect(podeVerTicket(usuario({ id: 'm', role: 'MASTER' }), ticket)).toBe(true);
    expect(podeVerTicket(usuario({ id: 'm', role: 'MASTER', oficinaId: 'of2' }), ticket)).toBe(
      false,
    );
    expect(podeVerTicket(usuario({ id: 'u2', permissoes: ['GERENTE'] }), ticket)).toBe(false);
    expect(podeVerTicket(cliente, ticket)).toBe(false);
    expect(
      podeVerTicket(usuario({ role: 'MASTER' }), {
        autorTipo: 'CLIENTE',
        autorId: 'c1',
        oficinaId: null,
      }),
    ).toBe(false);
  });

  it('mensagem do usuário: respondido volta para análise; resolvido reabre', () => {
    expect(statusAposMensagemDoUsuario('RESPONDIDO')).toBe('EM_ANALISE');
    expect(statusAposMensagemDoUsuario('RESOLVIDO')).toBe('ABERTO');
    expect(statusAposMensagemDoUsuario('ABERTO')).toBe('ABERTO');
    expect(statusAposMensagemDoUsuario('EM_ANALISE')).toBe('EM_ANALISE');
  });
});
