import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthService, type RespostaLogin } from '../auth/auth.service.js';
import { SenhaService } from '../auth/senha.service.js';
import { contextoAtual, exigirOficinaId } from '../common/contexto/contexto.js';
import { horaParaMinutos } from '../common/utils/documentos.js';
import { BancoService } from '../prisma/banco.service.js';
import type {
  AtualizarOficinaDto,
  CadastroOficinaDto,
  ConfigAgendamentoDto,
  ConfigDescontosDto,
  HorarioDiaDto,
} from './oficinas.dto.js';

export const DIAS_TESTE = 14;

/** Horário padrão de uma oficina nova: seg–sex 08–18 (almoço 12–13), sábado 08–12. */
export const HORARIOS_PADRAO: HorarioDiaDto[] = [
  ...[1, 2, 3, 4, 5].map((diaSemana) => ({
    diaSemana,
    abre: '08:00',
    fecha: '18:00',
    intervaloInicio: '12:00',
    intervaloFim: '13:00',
  })),
  { diaSemana: 6, abre: '08:00', fecha: '12:00' },
];

const SELECAO_OFICINA = {
  id: true,
  nome: true,
  documento: true,
  telefone: true,
  email: true,
  cep: true,
  rua: true,
  numero: true,
  complemento: true,
  bairro: true,
  cidade: true,
  uf: true,
  status: true,
  testeAte: true,
  mecanicoPodeDarDesconto: true,
  limiteDescontoPercentual: true,
  limiteDescontoCentavos: true,
  antecedenciaCancelamentoHoras: true,
  createdAt: true,
  plano: { select: { id: true, nome: true, maxMecanicos: true } },
} as const;

/** Valida um dia de funcionamento: abre < fecha e intervalo dentro do expediente. */
export function validarHorarioDia(d: HorarioDiaDto): void {
  const nomeDia = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][
    d.diaSemana
  ];
  const abre = horaParaMinutos(d.abre);
  const fecha = horaParaMinutos(d.fecha);
  if (abre >= fecha) {
    throw new BadRequestException(`${nomeDia}: o horário de abertura deve ser antes do fechamento`);
  }
  if (!d.intervaloInicio && !d.intervaloFim) return;
  if (!d.intervaloInicio || !d.intervaloFim) {
    throw new BadRequestException(`${nomeDia}: informe início e fim do intervalo`);
  }
  const ini = horaParaMinutos(d.intervaloInicio);
  const fim = horaParaMinutos(d.intervaloFim);
  if (!(abre < ini && ini < fim && fim < fecha)) {
    throw new BadRequestException(`${nomeDia}: o intervalo precisa ficar dentro do expediente`);
  }
}

@Injectable()
export class OficinasService {
  constructor(
    private readonly banco: BancoService,
    private readonly senhas: SenhaService,
    private readonly auth: AuthService,
  ) {}

  listarPlanos() {
    return this.banco.sistema.plano.findMany({
      where: { ativo: true },
      select: { id: true, nome: true, precoCentavos: true, maxMecanicos: true },
      orderBy: { precoCentavos: 'asc' },
    });
  }

  /** Autocadastro: oficina em TESTE por 14 dias + usuário MASTER + horários padrão. */
  async cadastrar(dto: CadastroOficinaDto): Promise<RespostaLogin> {
    const plano = await this.banco.sistema.plano.findFirst({
      where: { id: dto.planoId, ativo: true },
    });
    if (!plano) throw new BadRequestException('Plano inválido');

    const senhaHash = await this.senhas.gerarHash(dto.master.senha);
    const agora = new Date();

    const { oficina, master } = await this.banco.sistema.$transaction(async (tx) => {
      const oficina = await tx.oficina.create({
        data: {
          ...dto.oficina,
          planoId: plano.id,
          status: 'TESTE',
          testeAte: new Date(agora.getTime() + DIAS_TESTE * 24 * 60 * 60 * 1000),
          termosAceitosEm: agora,
        },
      });
      const master = await tx.user.create({
        data: {
          oficinaId: oficina.id,
          nome: dto.master.nome,
          email: dto.master.email,
          telefone: dto.master.telefone,
          senhaHash,
          role: 'MASTER',
          permissoes: [],
        },
      });
      await tx.horarioFuncionamento.createMany({
        data: HORARIOS_PADRAO.map((h) => ({ ...h, oficinaId: oficina.id })),
      });
      return { oficina, master };
    });

    // Atribui a auditoria do cadastro ao próprio master recém-criado.
    const ctx = contextoAtual();
    if (ctx) {
      ctx.ator = {
        tipo: 'USUARIO',
        id: master.id,
        nome: master.nome,
        email: master.email,
        oficinaId: oficina.id,
        role: 'MASTER',
        permissoes: [],
      };
    }
    return this.auth.concluirLogin('USUARIO', master.id, oficina.id);
  }

  async dados(oficinaId: string) {
    const oficina = await this.banco.sistema.oficina.findUnique({
      where: { id: oficinaId },
      select: SELECAO_OFICINA,
    });
    if (!oficina) throw new NotFoundException('Oficina não encontrada');
    return oficina;
  }

  atualizar(oficinaId: string, dto: AtualizarOficinaDto) {
    return this.banco.sistema.oficina.update({
      where: { id: oficinaId },
      data: dto,
      select: SELECAO_OFICINA,
    });
  }

  configurarDescontos(oficinaId: string, dto: ConfigDescontosDto) {
    const { motivo: _motivo, ...dados } = dto;
    return this.banco.sistema.oficina.update({
      where: { id: oficinaId },
      data: {
        mecanicoPodeDarDesconto: dados.mecanicoPodeDarDesconto,
        limiteDescontoPercentual: dados.limiteDescontoPercentual ?? null,
        limiteDescontoCentavos: dados.limiteDescontoCentavos ?? null,
      },
      select: SELECAO_OFICINA,
    });
  }

  configurarAgendamento(oficinaId: string, dto: ConfigAgendamentoDto) {
    return this.banco.sistema.oficina.update({
      where: { id: oficinaId },
      data: { antecedenciaCancelamentoHoras: dto.antecedenciaCancelamentoHoras },
      select: SELECAO_OFICINA,
    });
  }

  horarios() {
    return this.banco.tenant.horarioFuncionamento.findMany({
      where: { ativo: true },
      orderBy: { diaSemana: 'asc' },
      select: {
        diaSemana: true,
        abre: true,
        fecha: true,
        intervaloInicio: true,
        intervaloFim: true,
      },
    });
  }

  /** Substitui a semana inteira. Dias fora da lista ficam fechados (ativo = false, sem apagar). */
  async definirHorarios(dias: HorarioDiaDto[]) {
    const vistos = new Set<number>();
    for (const d of dias) {
      if (vistos.has(d.diaSemana)) {
        throw new BadRequestException('Cada dia da semana só pode aparecer uma vez');
      }
      vistos.add(d.diaSemana);
      validarHorarioDia(d);
    }

    await this.banco.tenant.$transaction(async (tx) => {
      for (let diaSemana = 0; diaSemana <= 6; diaSemana++) {
        const d = dias.find((x) => x.diaSemana === diaSemana);
        if (d) {
          const valores = {
            abre: d.abre,
            fecha: d.fecha,
            intervaloInicio: d.intervaloInicio ?? null,
            intervaloFim: d.intervaloFim ?? null,
            ativo: true,
          };
          const existente = await tx.horarioFuncionamento.findFirst({ where: { diaSemana } });
          if (existente) {
            await tx.horarioFuncionamento.update({ where: { id: existente.id }, data: valores });
          } else {
            await tx.horarioFuncionamento.create({
              data: { oficinaId: exigirOficinaId(), diaSemana, ...valores },
            });
          }
        } else {
          await tx.horarioFuncionamento.updateMany({
            where: { diaSemana, ativo: true },
            data: { ativo: false },
          });
        }
      }
    });
    return this.horarios();
  }
}
