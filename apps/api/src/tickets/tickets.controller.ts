import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { uploadAnexoTicket } from '../arquivos/upload.decorators.js';
import { Auditar } from '../auditoria/auditoria.decorators.js';
import { AtorAtual, Atores, ExigePermissaoPlataforma } from '../common/auth/decorators.js';
import { LimiteLogin } from '../common/auth/limites.js';
import type { Ator, AtorPlataforma } from '../common/contexto/contexto.js';
import {
  AbrirTicketDto,
  AtualizarTicketDto,
  FiltroFilaDto,
  FiltroMeusTicketsDto,
  MensagemSuporteDto,
  MensagemTicketDto,
} from './tickets.dto.js';
import { TicketsService } from './tickets.service.js';

const ID = new ParseUUIDPipe();
const TICKET = 'Ticket';

const DocAnexo = () => (alvo: object, chave: string, desc: PropertyDescriptor) => {
  ApiConsumes('multipart/form-data')(alvo, chave, desc);
  ApiBody({
    schema: {
      type: 'object',
      required: ['arquivo'],
      properties: { arquivo: { type: 'string', format: 'binary' } },
    },
  })(alvo, chave, desc);
};

/** Botão "Suporte": usuários das oficinas (master, mecânico, financeiro) e clientes. */
@ApiTags('Suporte — Tickets')
@ApiBearerAuth()
@Controller('tickets')
@Atores('USUARIO', 'CLIENTE')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  @LimiteLogin()
  @Auditar({ acao: 'TICKET_ABERTO', entidade: TICKET })
  @ApiOperation({
    summary: 'Abre ticket (erro, sugestão ou dúvida)',
    description:
      'O app envia `contexto` (versão, aparelho, sistema, tela). Devolve o número do ticket.',
  })
  abrir(@AtorAtual() a: Ator, @Body() dto: AbrirTicketDto) {
    return this.tickets.abrir(this.tickets.autor(a), dto);
  }

  @Get()
  @ApiOperation({ summary: 'Meus tickets (o master também vê os dos funcionários)' })
  listar(@AtorAtual() a: Ator, @Query() f: FiltroMeusTicketsDto) {
    return this.tickets.listarMeus(this.tickets.autor(a), f.status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ticket com a conversa (sem notas internas) e anexos' })
  detalhar(@AtorAtual() a: Ator, @Param('id', ID) id: string) {
    return this.tickets.detalharParaUsuario(this.tickets.autor(a), id);
  }

  @Post(':id/mensagens')
  @Auditar({ acao: 'TICKET_MENSAGEM_USUARIO', entidade: 'TicketMensagem' })
  @ApiOperation({ summary: 'Responde no ticket (reabre se estava resolvido)' })
  responder(@AtorAtual() a: Ator, @Param('id', ID) id: string, @Body() dto: MensagemTicketDto) {
    return this.tickets.responderComoUsuario(this.tickets.autor(a), id, dto.texto);
  }

  @Post(':id/anexos')
  @uploadAnexoTicket()
  @DocAnexo()
  @Auditar({ acao: 'TICKET_ANEXO_ADICIONADO', entidade: 'Arquivo' })
  @ApiOperation({ summary: 'Anexa foto (até 10 MB) ou vídeo (até 50 MB); até 5 por ticket' })
  anexar(
    @AtorAtual() a: Ator,
    @Param('id', ID) id: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
  ) {
    return this.tickets.anexarComoUsuario(this.tickets.autor(a), id, arquivo);
  }

  @Post(':id/resolver')
  @HttpCode(HttpStatus.OK)
  @Auditar({ acao: 'TICKET_RESOLVIDO_PELO_USUARIO', entidade: TICKET })
  @ApiOperation({ summary: 'Marca como resolvido' })
  resolver(@AtorAtual() a: Ator, @Param('id', ID) id: string) {
    return this.tickets.resolverComoUsuario(this.tickets.autor(a), id);
  }
}

/** Fila do suporte (admins com SUPORTE). */
@ApiTags('Plataforma — Tickets')
@ApiBearerAuth()
@Controller('plataforma/tickets')
@Atores('PLATAFORMA')
@ExigePermissaoPlataforma('SUPORTE')
export class FilaTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @ApiOperation({ summary: 'Fila: não resolvidos por padrão, por prioridade e antiguidade' })
  fila(@AtorAtual() a: AtorPlataforma, @Query() f: FiltroFilaDto) {
    return this.tickets.fila(a, f);
  }

  @Get('indicadores')
  @ApiOperation({ summary: 'Abertos, tempo médio de primeira resposta e erros mais reportados' })
  indicadores() {
    return this.tickets.indicadores();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ticket completo (com notas internas, autor e oficina)' })
  detalhar(@Param('id', ID) id: string) {
    return this.tickets.detalharParaSuporte(id);
  }

  @Patch(':id')
  @Auditar({ acao: 'TICKET_ATUALIZADO', entidade: TICKET })
  @ApiOperation({ summary: 'Status, prioridade e responsável' })
  atualizar(@Param('id', ID) id: string, @Body() dto: AtualizarTicketDto) {
    return this.tickets.atualizar(id, dto);
  }

  @Post(':id/mensagens')
  @Auditar({ acao: 'TICKET_MENSAGEM_SUPORTE', entidade: 'TicketMensagem' })
  @ApiOperation({ summary: 'Responde ao usuário ou registra nota interna (`interna: true`)' })
  responder(
    @AtorAtual() a: AtorPlataforma,
    @Param('id', ID) id: string,
    @Body() dto: MensagemSuporteDto,
  ) {
    return this.tickets.responderComoSuporte(a, id, dto);
  }

  @Post(':id/anexos')
  @uploadAnexoTicket()
  @DocAnexo()
  @Auditar({ acao: 'TICKET_ANEXO_ADICIONADO', entidade: 'Arquivo' })
  @ApiOperation({ summary: 'Anexa foto ou vídeo pelo suporte' })
  anexar(
    @AtorAtual() a: AtorPlataforma,
    @Param('id', ID) id: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
  ) {
    return this.tickets.anexarComoSuporte(a, id, arquivo);
  }
}
