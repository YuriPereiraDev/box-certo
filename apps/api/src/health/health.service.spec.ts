import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  const prisma = { $queryRaw: vi.fn() };
  let service: HealthService;

  beforeEach(async () => {
    prisma.$queryRaw.mockReset();
    const modulo = await Test.createTestingModule({
      providers: [HealthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = modulo.get(HealthService);
  });

  it('retorna ok quando o banco responde', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const r = await service.verificar();
    expect(r.status).toBe('ok');
    expect(r.servicos.banco).toBe('up');
  });

  it('retorna erro quando o banco falha', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('conexão recusada'));
    const r = await service.verificar();
    expect(r.status).toBe('erro');
    expect(r.servicos.banco).toBe('down');
  });
});
