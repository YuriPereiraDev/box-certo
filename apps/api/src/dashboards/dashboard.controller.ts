import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores } from '../common/auth/decorators.js';
import type { AtorUsuario } from '../common/contexto/contexto.js';
import { BancoService } from '../prisma/banco.service.js';
import { ExportarDashboardDto, FiltroDashboardDto } from './dashboard.dto.js';
import { DashboardService } from './dashboard.service.js';
import { ExportacaoDashboardService } from './exportacao.service.js';

@ApiTags('Oficina — Dashboard')
@ApiBearerAuth()
@Controller('oficina/dashboard')
@Atores('USUARIO')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly exportacao: ExportacaoDashboardService,
    private readonly banco: BancoService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Indicadores do master (MASTER, GERENTE ou FINANCEIRO; mecânico comum: 403)',
    description:
      'Faturamento = OS pagas no período. Bloco `financeiro` (lucro = faturamento − despesas do período) só para MASTER ou permissão FINANCEIRO; nos demais vem null.',
  })
  montar(@AtorAtual() a: AtorUsuario, @Query() f: FiltroDashboardDto) {
    return this.dashboard.montar(a, f);
  }

  @Get('exportar')
  @ApiProduces(
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Auditar({ acao: 'DASHBOARD_EXPORTADO', entidade: 'Dashboard' })
  @ApiOperation({ summary: 'Exporta o dashboard em PDF ou Excel (mesmas permissões)' })
  async exportar(@AtorAtual() a: AtorUsuario, @Query() f: ExportarDashboardDto) {
    const dados = await this.dashboard.montar(a, f);
    const { nome } = await this.banco.sistema.oficina.findUniqueOrThrow({
      where: { id: a.oficinaId },
      select: { nome: true },
    });
    const arquivo = `dashboard-${dados.periodo.de}-a-${dados.periodo.ate}.${f.formato}`;
    const buffer =
      f.formato === 'xlsx'
        ? await this.exportacao.xlsx(dados, nome)
        : await this.exportacao.pdf(dados, nome);
    return new StreamableFile(buffer, {
      type:
        f.formato === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf',
      disposition: `attachment; filename="${arquivo}"`,
    });
  }
}
