# Box Certo — Especificação do projeto

> Este arquivo é a especificação completa do sistema. Claude: leia tudo antes de começar.
> Trabalhe **uma fase por vez** (seção 12). Ao terminar cada fase: rode lint e testes,
> resuma o que foi feito e espere minha confirmação antes de seguir.
> Se algo não estiver descrito aqui, pergunte antes de decidir.

---

## 1. Visão geral

Box Certo é um SaaS para oficinas mecânicas: agendamento de clientes, ordens de serviço,
orçamentos aprovados pelo cliente no app, estoque, despesas, dashboards e auditoria completa.

- Atende do mecânico autônomo até oficinas com vários funcionários.
- Um único backend e um único banco para todas as oficinas (**multi-tenant**). Cada oficina é um tenant isolado.
- Vendido por assinatura mensal (planos na seção 10).
- Desenvolvimento inicial **100% local**, no Windows, com Docker.

### Plataformas
- **Android** (Play Store) — primeira loja.
- **Windows desktop** e **web** (painel da oficina e da plataforma).
- **iOS / App Store: em breve** (o código Flutter já deve funcionar, mas não é prioridade).

---

## 2. Stack

| Camada | Tecnologia |
| --- | --- |
| Backend | Node.js LTS + **NestJS** + TypeScript |
| ORM | **Prisma** (versão estável atual, 7.x — seguir a doc atual: `prisma.config.ts` + driver adapter do PostgreSQL) |
| Banco | **PostgreSQL** |
| App (Android, Windows, web) | **Flutter** + Riverpod + go_router + Dio |
| Gráficos | fl_chart |
| Calendário | table_calendar |
| Arquivos (fotos, vídeos, comprovantes) | **SeaweedFS** local (API compatível com S3; o MinIO deixou de publicar imagens Docker); em produção Cloudflare R2 ou S3 |
| E-mail em dev | **Mailpit** (captura os e-mails localmente) |
| Push | Firebase Cloud Messaging (fase 11) |
| PDF | pdfmake (backend) |
| Validação | class-validator + class-transformer |
| Testes | **Vitest** (unitário, mesma API do Jest — padrão do NestJS 12, que é só ESM) + Supertest (e2e) no backend; flutter_test no app |
| Qualidade | ESLint + Prettier; `flutter analyze` |
| Monitoramento | Sentry (opcional em dev) |

Ambiente do desenvolvedor: **Windows**, Docker Desktop (WSL2), VS Code.
Para build Windows do Flutter é preciso o Visual Studio com a carga "Desenvolvimento para desktop com C++".

---

## 3. Estrutura do repositório (monorepo)

```
box-certo/
├─ CLAUDE.md                 # este arquivo
├─ docker-compose.yml        # postgres, seaweedfs (S3), mailpit (e a api, opcional)
├─ .env.example
├─ apps/
│  ├─ api/                   # NestJS
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma
│  │  │  ├─ migrations/
│  │  │  └─ seed.ts          # cria o super admin dono e dados de exemplo
│  │  ├─ prisma.config.ts
│  │  └─ src/
│  │     ├─ common/          # guards, decorators, interceptors, filtros, utils de dinheiro/data
│  │     ├─ auth/
│  │     ├─ platform/        # painel da plataforma (super admin)
│  │     ├─ oficinas/
│  │     ├─ usuarios/
│  │     ├─ clientes/
│  │     ├─ veiculos/
│  │     ├─ convites/
│  │     ├─ tabela-precos/
│  │     ├─ agendamentos/
│  │     ├─ ordens-servico/  # OS + orçamento + itens + descontos + fotos
│  │     ├─ estoque/
│  │     ├─ despesas/
│  │     ├─ dashboards/
│  │     ├─ tickets/
│  │     ├─ integracoes/     # WhatsApp por oficina
│  │     ├─ notificacoes/
│  │     ├─ arquivos/        # upload para S3 (SeaweedFS em dev, R2/S3 em produção)
│  │     └─ auditoria/
│  └─ app/                   # Flutter
│     └─ lib/
│        ├─ core/            # api client, auth, tema, rotas, permissões
│        ├─ features/
│        │  ├─ cliente/
│        │  ├─ mecanico/
│        │  ├─ oficina/      # master, gerente, financeiro
│        │  ├─ plataforma/   # super admin
│        │  └─ suporte/
│        └─ main.dart
└─ docs/
```

---

## 4. Perfis e permissões

Existem **três tipos de conta**, com autenticação separada:

1. **Admin da plataforma** (`PlatformAdmin`) — equipe do Box Certo. Não pertence a nenhuma oficina.
2. **Usuário da oficina** (`User`) — master, mecânico, financeiro. Sempre ligado a uma oficina.
3. **Cliente** (`Cliente`) — dono do veículo. Conta global, vinculada a uma ou mais oficinas por convite.

### 4.1 Admin da plataforma
- O primeiro admin (**dono**, `isOwner = true`) é criado **somente pelo seed**, com e-mail e senha vindos do `.env`. Nunca existe cadastro público de admin.
- O dono cria outros admins e marca permissões individuais:

| Permissão | Libera |
| --- | --- |
| `FINANCEIRO` | faturamento do Box Certo, valores de planos, descontos em assinaturas, ranking de faturamento das oficinas |
| `GESTAO_OFICINAS` | suspender/reativar oficina, trocar plano, estender teste |
| `GESTAO_USUARIOS` | buscar, bloquear e resetar senha de qualquer usuário |
| `SUPORTE` | fila de tickets e modo suporte |
| `GESTAO_ADMINS` | criar/editar/remover admins |

- **Admins criados não têm `FINANCEIRO` por padrão.** Só o dono tem tudo.
- 2FA (TOTP) obrigatório para admins.

### 4.2 Usuários da oficina

| Perfil (`role`) | Descrição |
| --- | --- |
| `MASTER` | dono da oficina. Tem todas as permissões da oficina, sempre. |
| `MECANICO` | faz diagnósticos e orçamentos. Vê só a própria agenda e as próprias OS (salvo `GERENTE`). |
| `FINANCEIRO` | funcionário administrativo, não é mecânico. |

Permissões extras marcáveis pelo master em qualquer usuário:

| Permissão | Libera |
| --- | --- |
| `GERENTE` | dar desconto em **qualquer** orçamento de qualquer mecânico da oficina; ver todas as OS e agendas |
| `FINANCEIRO` | aba Despesas, lucro, custo de peças, contas a pagar |
| `VER_SALARIOS` | ver despesas da categoria salários/funcionários (exige `FINANCEIRO`) |
| `GERIR_ESTOQUE` | cadastrar peças, entradas e ajustes de estoque |
| `VER_LOGS` | aba Logs da oficina |

Regras:
- Mecânico comum **não vê**: despesas, salários, lucro, custo de compra das peças, contas a pagar.
- O bloqueio é feito **na API** (guards), não só escondendo na tela. Campos sensíveis devem ser removidos das respostas quando o usuário não tem permissão (ex.: `custoUnitario` em itens e estoque).
- Um mecânico autônomo é simplesmente uma oficina com um único `MASTER`, que também atua como mecânico.

### 4.3 Cliente
- **Não existe cadastro livre.** O cliente só cria conta (ou se vincula) através de um **link de convite** de uma oficina.
- Um cliente pode estar vinculado a várias oficinas. **Cada oficina só vê os dados dele relacionados a ela** (veículos atendidos, OS, agendamentos dela).
- O cliente vê suas oficinas, agenda horários, aprova/recusa itens de orçamento e abre tickets.

---

## 5. Multi-tenant e segurança

- Toda tabela de dados da oficina tem `oficinaId`.
- O `oficinaId` vem **sempre do token**, nunca do corpo da requisição.
- Criar uma **extensão do Prisma** (ou repositório base) que injeta automaticamente o filtro `oficinaId` nas consultas de usuários da oficina.
- Testes e2e obrigatórios garantindo que um usuário da oficina A **não** consegue ler nem alterar nada da oficina B (ids de outra oficina devem retornar 404).
- Oficina com status `SUSPENSA` ou `CANCELADA`: usuários dela recebem 403 com mensagem clara; dados são mantidos.
- Senhas com argon2 (ou bcrypt cost ≥ 12).
- JWT de acesso curto (15 min) + refresh token rotativo salvo com hash no banco.
- Rate limit em login e endpoints públicos (`@nestjs/throttler`), Helmet, CORS restrito.
- Tokens de integração (WhatsApp) criptografados no banco com AES-256-GCM (chave no `.env`).
- **Dinheiro sempre em centavos (`Int`)**, nunca `float`.
- Datas salvas em UTC; exibição em `America/Sao_Paulo`.
- Exclusões são **lógicas** (`deletedAt` / `ativo = false`). Nada é apagado de verdade.
- LGPD: consentimento no cadastro do cliente, exportação dos dados de uma oficina, termos de uso e política de privacidade.

---

## 6. Modelo de dados (rascunho para o `schema.prisma`)

Use como ponto de partida; ajuste nomes e índices conforme necessário, mas mantenha as regras.

```prisma
enum OficinaStatus { TESTE ATIVA SUSPENSA CANCELADA }
enum UserRole { MASTER MECANICO FINANCEIRO }
enum PermissaoOficina { GERENTE FINANCEIRO VER_SALARIOS GERIR_ESTOQUE VER_LOGS }
enum PermissaoPlataforma { FINANCEIRO GESTAO_OFICINAS GESTAO_USUARIOS SUPORTE GESTAO_ADMINS }
enum TipoItem { PECA MAO_DE_OBRA }
enum OrigemPeca { ESTOQUE COMPRADA_SEPARADO CLIENTE_COMPRA }
enum StatusItemCliente { PENDENTE APROVADO RECUSADO }
enum StatusOS { ABERTA EM_DIAGNOSTICO ORCAMENTO_ENVIADO APROVADA EM_EXECUCAO CONCLUIDA CANCELADA }
enum StatusAgendamento { AGENDADO CONFIRMADO EM_ATENDIMENTO CONCLUIDO CANCELADO NAO_COMPARECEU }
enum TipoDesconto { PERCENTUAL VALOR }
enum StatusDesconto { APLICADO PENDENTE_APROVACAO RECUSADO }
enum StatusPagamento { PENDENTE PAGO_NA_OFICINA }   // pagamento online: em breve
enum TipoMovEstoque { ENTRADA SAIDA RESERVA LIBERACAO_RESERVA AJUSTE }
enum StatusDespesa { A_PAGAR PAGO }
enum TipoTicket { ERRO SUGESTAO DUVIDA }
enum StatusTicket { ABERTO EM_ANALISE RESPONDIDO RESOLVIDO }
enum TipoAtor { PLATAFORMA USUARIO CLIENTE SISTEMA SUPORTE }

model Plano {
  id            String  @id @default(uuid())
  nome          String  // Autônomo, Oficina, Rede
  precoCentavos Int
  maxMecanicos  Int?    // null = ilimitado
  ativo         Boolean @default(true)
  oficinas      Oficina[]
}

model Oficina {
  id                 String        @id @default(uuid())
  nome               String
  documento          String?       // CPF ou CNPJ
  telefone           String?
  email              String?
  cep String? rua String? numero String? complemento String? bairro String? cidade String? uf String?
  status             OficinaStatus @default(TESTE)
  planoId            String
  plano              Plano         @relation(fields: [planoId], references: [id])
  testeAte           DateTime?
  precoFundadorCentavos Int?       // preço travado para primeiras oficinas
  // parâmetros de desconto
  mecanicoPodeDarDesconto Boolean  @default(false)
  limiteDescontoPercentual Int?    // ex.: 10 = 10%
  limiteDescontoCentavos   Int?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
}

model HorarioFuncionamento {
  id         String @id @default(uuid())
  oficinaId  String
  diaSemana  Int    // 0 = domingo
  abre       String // "08:00"
  fecha      String // "18:00"
  intervaloInicio String?
  intervaloFim    String?
}

model PlatformAdmin {
  id          String  @id @default(uuid())
  nome        String
  email       String  @unique
  senhaHash   String
  isOwner     Boolean @default(false)
  permissoes  PermissaoPlataforma[]
  totpSecret  String?
  ativo       Boolean @default(true)
  createdAt   DateTime @default(now())
}

model User {
  id          String   @id @default(uuid())
  oficinaId   String
  nome        String
  email       String
  telefone    String?
  senhaHash   String
  role        UserRole
  permissoes  PermissaoOficina[]
  ativo       Boolean  @default(true)
  createdAt   DateTime @default(now())
  @@unique([oficinaId, email])
}

model Cliente {
  id             String   @id @default(uuid())
  nome           String
  cpf            String   @unique
  dataNascimento DateTime?
  rg             String?
  email          String   @unique
  telefone       String?
  cep String? rua String? numero String? complemento String? bairro String? cidade String? uf String?
  senhaHash      String
  consentimentoLgpdEm DateTime
  createdAt      DateTime @default(now())
}

model ClienteOficina {             // vínculo criado pelo convite
  clienteId  String
  oficinaId  String
  conviteId  String?
  observacoesInternas String?    // visível só para a oficina
  createdAt  DateTime @default(now())
  @@id([clienteId, oficinaId])
}

model Veiculo {
  id          String  @id @default(uuid())
  clienteId   String
  placa       String
  marca       String?
  modelo      String?
  ano         Int?
  motor       String?
  cor         String?
  combustivel String?
  chassi      String?
  @@unique([clienteId, placa])
}

model Convite {
  id         String   @id @default(uuid())
  oficinaId  String
  codigo     String   @unique   // curto, ex.: ZE7K2P
  individual Boolean  @default(false)
  nome       String?
  telefone   String?
  expiraEm   DateTime?
  usos       Int      @default(0)
  maxUsos    Int?
  ativo      Boolean  @default(true)
  criadoPorId String
  createdAt  DateTime @default(now())
}

model ItemTabelaPreco {            // tabela interna (cliente nunca vê)
  id              String   @id @default(uuid())
  oficinaId       String
  nome            String
  tipo            TipoItem
  precoCentavos   Int
  tempoEstimadoMin Int?
  estoqueItemId   String?  // peça ligada ao estoque, opcional
  linkAfiliadoPadrao String?
  ativo           Boolean  @default(true)
}

model Agendamento {
  id          String   @id @default(uuid())
  oficinaId   String
  clienteId   String
  veiculoId   String
  mecanicoId  String?
  tipoServico String
  inicio      DateTime
  fim         DateTime
  status      StatusAgendamento @default(AGENDADO)
  observacaoCliente String?
  createdAt   DateTime @default(now())
}

model OrdemServico {
  id            String   @id @default(uuid())
  oficinaId     String
  numero        Int      // sequencial por oficina
  agendamentoId String?  @unique
  clienteId     String
  veiculoId     String
  mecanicoId    String
  status        StatusOS @default(ABERTA)
  kmEntrada     Int?     // todos os campos de verificação são opcionais
  combustivel   String?
  estadoVeiculo String?
  diagnostico   String?
  observacoes   String?
  descontoTipo  TipoDesconto?
  descontoValor Int?     // % inteiro ou centavos
  descontoStatus StatusDesconto?
  descontoPorId String?
  descontoMotivo String?
  statusPagamento StatusPagamento @default(PENDENTE)
  formaPagamento  String?
  enviadoEm     DateTime?
  concluidoEm   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([oficinaId, numero])
}

model ItemOrcamento {
  id                 String   @id @default(uuid())
  ordemServicoId     String
  tabelaPrecoId      String?
  descricao          String
  tipo               TipoItem
  origemPeca         OrigemPeca?       // só para PECA
  estoqueItemId      String?           // quando origem = ESTOQUE
  quantidade         Int      @default(1)
  precoUnitarioCentavos Int
  custoUnitarioCentavos Int?           // sensível: só MASTER/FINANCEIRO
  linkAfiliado       String?
  descontoTipo       TipoDesconto?
  descontoValor      Int?
  descontoStatus     StatusDesconto?
  descontoPorId      String?
  statusCliente      StatusItemCliente @default(PENDENTE)
  respondidoEm       DateTime?
}

model Arquivo {                    // fotos de OS, anexos de ticket, comprovantes
  id          String @id @default(uuid())
  oficinaId   String?
  chave       String  // caminho no bucket
  mime        String
  tamanhoBytes Int
  entidade    String  // ORDEM_SERVICO, TICKET, DESPESA, ESTOQUE
  entidadeId  String
  enviadoPorTipo TipoAtor
  enviadoPorId   String
  createdAt   DateTime @default(now())
}

model EstoqueItem {
  id                 String  @id @default(uuid())
  oficinaId          String
  nome               String
  codigo             String?
  marca              String?
  aplicacao          String?
  quantidade         Int     @default(0)
  quantidadeReservada Int    @default(0)
  custoCentavos      Int     // sensível
  precoVendaCentavos Int
  estoqueMinimo      Int     @default(0)
  localizacao        String?
  ativo              Boolean @default(true)
}

model MovimentoEstoque {
  id            String  @id @default(uuid())
  oficinaId     String
  estoqueItemId String
  tipo          TipoMovEstoque
  quantidade    Int
  custoUnitarioCentavos Int?
  fornecedor    String?
  notaFiscal    String?
  ordemServicoId String?
  motivo        String?
  usuarioId     String
  createdAt     DateTime @default(now())
}

model CategoriaDespesa {
  id         String  @id @default(uuid())
  oficinaId  String
  nome       String
  ehSalario  Boolean @default(false)   // protegida por VER_SALARIOS
  padrao     Boolean @default(false)
}

model DespesaRecorrente {
  id            String  @id @default(uuid())
  oficinaId     String
  descricao     String
  valorCentavos Int
  categoriaId   String
  diaVencimento Int
  funcionarioId String?
  ativa         Boolean @default(true)
}

model Despesa {
  id            String   @id @default(uuid())
  oficinaId     String
  data          DateTime
  descricao     String
  valorCentavos Int
  categoriaId   String
  formaPagamento String?
  status        StatusDespesa
  vencimento    DateTime?
  pagoEm        DateTime?
  recorrenteId  String?
  funcionarioId String?   // pagamento de funcionário
  subtipoSalario String?  // SALARIO, VALE, COMISSAO, DECIMO_TERCEIRO, FERIAS, HORA_EXTRA, BENEFICIO
  movimentoEstoqueId String?
  criadoPorId   String
  createdAt     DateTime @default(now())
  deletedAt     DateTime?
}

model Ticket {
  id           String  @id @default(uuid())
  numero       Int     @unique @default(autoincrement())
  oficinaId    String?
  autorTipo    TipoAtor
  autorId      String
  tipo         TipoTicket
  titulo       String
  descricao    String
  status       StatusTicket @default(ABERTO)
  prioridade   Int     @default(0)
  atribuidoAId String?
  contexto     Json?   // versão do app, aparelho, SO, tela atual
  createdAt    DateTime @default(now())
}

model TicketMensagem {
  id        String @id @default(uuid())
  ticketId  String
  autorTipo TipoAtor
  autorId   String
  texto     String
  createdAt DateTime @default(now())
}

model IntegracaoWhatsapp {
  id            String  @id @default(uuid())
  oficinaId     String  @unique
  provedor      String  // META_CLOUD (recomendado) ou outro
  phoneNumberId String?
  tokenCriptografado String
  ativo         Boolean @default(false)
}

model AvisoGlobal {
  id        String   @id @default(uuid())
  titulo    String
  mensagem  String
  inicio    DateTime
  fim       DateTime?
  criadoPorId String
}

model AuditLog {                    // somente INSERT (ver seção 9)
  id         String   @id @default(uuid())
  oficinaId  String?
  atorTipo   TipoAtor
  atorId     String?
  atorNome   String?
  acao       String   // ex.: ORCAMENTO_DESCONTO_APLICADO
  entidade   String
  entidadeId String?
  antes      Json?
  depois     Json?
  motivo     String?
  ip         String?
  userAgent  String?
  origem     String?  // APP_ANDROID, DESKTOP, WEB
  createdAt  DateTime @default(now())
  @@index([oficinaId, createdAt])
  @@index([entidade, entidadeId])
}

model RefreshToken { id String @id @default(uuid()) atorTipo TipoAtor atorId String hash String expiraEm DateTime revogadoEm DateTime? }
model PushToken    { id String @id @default(uuid()) atorTipo TipoAtor atorId String token String plataforma String }
```

---

## 7. Regras de negócio

### 7.1 Convite e cadastro do cliente
1. A oficina gera um convite (geral ou individual) → link `https://<dominio>/convite/<codigo>` + QR code.
2. Ao abrir o link:
   - sem conta → tela de cadastro (nome, CPF, data de nascimento, RG opcional, e-mail, telefone, endereço com CEP via ViaCEP, senha, aceite LGPD);
   - com conta (mesmo CPF/e-mail) → login e vínculo à nova oficina.
3. O vínculo cria `ClienteOficina`. Validar CPF (dígitos verificadores) e e-mail.
4. App não instalado: o link abre a página web com botão para a Play Store e, depois de instalado, o app retoma o código (App Links no Android; guardar o código e pedir para colar como alternativa simples na primeira versão).
5. Convite expirado, inativo ou com `maxUsos` atingido → mensagem clara.

### 7.2 Agendamento
- Horários livres calculados a partir de `HorarioFuncionamento`, duração do serviço e agendamentos existentes (por mecânico, se definido).
- Cliente pode reagendar ou cancelar até X horas antes (parâmetro da oficina, padrão 2h).
- Notificações: confirmação, lembrete no dia anterior e 1h antes (push/e-mail; WhatsApp se a oficina tiver integração ativa).

### 7.3 Ordem de serviço e orçamento
- A OS nasce de um agendamento ou é aberta direto no balcão.
- Campos de verificação (km, combustível, estado, observações) são **todos opcionais**.
- Itens vêm da tabela interna (preço preenchido automaticamente, editável naquele orçamento) ou são digitados manualmente.
- Cada peça tem **origem**:
  - `ESTOQUE` → precisa de `estoqueItemId`; mostra quantidade disponível;
  - `COMPRADA_SEPARADO` → custo opcional para cálculo de lucro;
  - `CLIENTE_COMPRA` → cliente compra por conta própria via link.
- Cada peça pode ter **link de afiliado** (opcional). No app do cliente aparece o botão "Comprar peça".
- "Enviar ao cliente" → status `ORCAMENTO_ENVIADO` + notificação. O cliente aprova ou recusa **item por item**.
- Total = soma dos itens aprovados − descontos.
- Orçamento em PDF (com logo e dados da oficina) disponível para download/compartilhamento.
- Fotos do diagnóstico anexadas à OS.

### 7.4 Descontos
- Tipos: percentual (%) ou valor (R$), por item ou no total da OS.
- Cliente vê o valor original riscado, o desconto e o total.
- Parâmetros da oficina (`Configurações > Descontos`):
  - `mecanicoPodeDarDesconto` (sim/não) — vale apenas para as **próprias** OS do mecânico;
  - limite opcional (% e/ou R$).
- Desconto acima do limite → `PENDENTE_APROVACAO` até um `GERENTE` ou o `MASTER` aprovar.
- `GERENTE` e `MASTER` podem dar desconto em **qualquer** OS da oficina.
- Todo desconto registra quem, quando, valor e motivo opcional.

### 7.5 Estoque
- Peça com origem `ESTOQUE`:
  - aprovação do cliente → `RESERVA` (aumenta `quantidadeReservada`);
  - recusa ou cancelamento → `LIBERACAO_RESERVA`;
  - OS concluída → `SAIDA` (baixa quantidade e reserva).
- Não permitir reservar mais do que `quantidade - quantidadeReservada` (avisar e permitir trocar a origem).
- Entrada de compra pode gerar uma `Despesa` automaticamente (checkbox, padrão marcado).
- Ajuste manual exige motivo.
- Alerta quando `quantidade <= estoqueMinimo`.
- Custo de compra só para `MASTER` / `FINANCEIRO`.
- Operações de estoque dentro de **transação** do banco.

### 7.6 Despesas
- Acesso: `MASTER` ou permissão `FINANCEIRO`. Salários exigem também `VER_SALARIOS`.
- Categorias padrão criadas com a oficina: Aluguel, Energia, Água, Internet, Salários e funcionários (`ehSalario`), Peças, Ferramentas, Impostos, Manutenção, Outros.
- Despesa recorrente gera automaticamente a despesa do mês (job diário).
- Pagamento de funcionário vinculado ao `User` e com subtipo (salário, vale, comissão, 13º, férias, hora extra, benefício).
- Comprovante como anexo (opcional).
- Lembrete de contas a vencer (push/e-mail ao master e financeiros).

### 7.7 Suporte (tickets)
- Botão "Suporte" sempre visível para qualquer usuário (master, mecânico, financeiro, cliente).
- Tipo (erro/sugestão/dúvida), título, descrição, até 5 anexos de foto/vídeo (vídeo ≤ 2 min ou 50 MB; comprimir no app antes de enviar).
- O app envia automaticamente: versão do app, aparelho, sistema e rota atual.
- O usuário recebe o número do ticket, acompanha o status e conversa dentro do ticket.

### 7.8 WhatsApp (por oficina)
- Opcional e **pago pela própria oficina**: cada oficina conecta a **própria** API e número.
- Recomendado: API oficial da Meta (WhatsApp Cloud API).
- Tela `Integrações > WhatsApp`: informar credenciais, testar envio, ativar/desativar.
- Sem integração ativa → só push e e-mail.
- Implementar via interface `WhatsappProvider` para permitir outros provedores depois.

### 7.9 Assinatura da oficina
- Nova oficina começa em `TESTE` por 14 dias.
- O plano limita o número de mecânicos ativos.
- **Pagamento online: em breve.** Por enquanto o super admin muda o status manualmente.
- Deixar o código preparado (`StatusPagamento`, interface de gateway) sem implementar cobrança.

---

## 8. Módulos e endpoints (visão geral)

Prefixos: `/plataforma/*` (admins), `/oficina/*` (usuários da oficina), `/cliente/*` (clientes), `/publico/*` (sem login).

- **Auth**: `POST /auth/plataforma/login` (+ TOTP), `POST /auth/oficina/login`, `POST /auth/cliente/login`, `POST /auth/refresh`, `POST /auth/logout`, recuperação de senha.
- **Público**: `GET /publico/convites/:codigo`, `POST /publico/convites/:codigo/cadastro`, `POST /publico/convites/:codigo/vincular`.
- **Oficina**: dados e configurações, horários, parâmetros de desconto, usuários e permissões, convites, tabela de preços, clientes e veículos (com histórico), agendamentos, OS/orçamentos/itens/descontos/fotos/PDF, estoque e movimentos, despesas e categorias, dashboards, logs, integrações, tickets.
- **Cliente**: minhas oficinas, meus veículos, horários disponíveis, agendar/reagendar/cancelar, meus orçamentos (aprovar/recusar item), histórico, tickets.
- **Plataforma**: dashboard, oficinas (listar, detalhar, suspender, reativar, trocar plano, estender teste, exportar dados), usuários, admins e permissões, planos, tickets, avisos globais, logs, saúde do sistema.

Documentar a API com Swagger (`@nestjs/swagger`) em `/docs`.

---

## 9. Auditoria (logs)

**Nada pode passar despercebido.** Toda ação que cria, altera ou exclui algo, e todo login, gera um `AuditLog`.

- Interceptor global do NestJS registra ator, ação, entidade, IP, user agent e origem.
- Extensão do Prisma grava `antes` e `depois` das alterações.
- Ações com motivo (desconto, ajuste de estoque, exclusão) gravam o motivo.
- Registrar também: tentativas de login com falha, exportações, uso do modo suporte, mudanças de permissão e configuração.
- A tabela `AuditLog` é **somente inserção**: criar no banco um usuário da aplicação sem `UPDATE`/`DELETE` nessa tabela (ou trigger que bloqueia). Nenhuma tela permite editar ou apagar log.
- Particionar por mês quando o volume crescer.
- **Aba Logs da oficina** (master ou `VER_LOGS`): só logs da própria oficina, filtros por usuário, ação, período e entidade; linha do tempo por OS e por veículo; ações do suporte aparecem como "Suporte Box Certo"; exportação PDF/Excel.
- **Aba Logs da plataforma** (dono do app e admins): todas as oficinas + ações dos admins; alertas de atividade suspeita (muitas falhas de login, exclusões em massa, horário fora do padrão).
- Modo suporte: o admin entra na visão de uma oficina com token especial, de tempo limitado, e tudo fica registrado com `atorTipo = SUPORTE`.

---

## 10. Dashboards e planos

### Dashboard do master
- Cards: faturamento do mês, orçamentos aprovados × recusados, agendamentos do dia, ticket médio, total de descontos.
- Gráficos: faturamento por mês, faturamento/produtividade por mecânico, serviços e peças mais feitos.
- Financeiro (só com permissão): receitas − despesas = lucro do mês, despesas por categoria, contas a vencer em 7 dias.
- Filtros por período e mecânico; exportação PDF/Excel.

### Dashboard da plataforma
- Faturamento do Box Certo no mês (assinaturas ativas) — só com `FINANCEIRO`.
- Oficinas ativas, em teste, suspensas, canceladas; churn; novas por mês; testes acabando.
- Total de mecânicos e clientes finais.
- Ranking das oficinas que mais faturam (só com `FINANCEIRO`).
- Tickets abertos, tempo médio de resposta, erros mais reportados.

### Planos (seed)
| Plano | Mecânicos | Preço |
| --- | --- | --- |
| Autônomo | 1 | R$ 59/mês |
| Oficina | até 5 | R$ 119/mês |
| Rede | ilimitado | R$ 199/mês |

---

## 11. Ambiente local

### `docker-compose.yml` (mínimo)
- `postgres` (porta 5432, volume persistente)
- `seaweedfs` (API S3 na porta 9000, painel do master na 9333) + `seaweedfs-init`, que cria o bucket `box-certo`
- `mailpit` (SMTP 1025, painel 8025)
- `api` opcional (em dev pode rodar fora do Docker com `npm run start:dev`)

### `.env.example`
```
DATABASE_URL=postgresql://boxcerto:boxcerto@localhost:5432/boxcerto
JWT_ACCESS_SECRET=troque
JWT_REFRESH_SECRET=troque
ENCRYPTION_KEY=chave-32-bytes-base64
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=box-certo
S3_ACCESS_KEY=boxcerto
S3_SECRET_KEY=boxcerto123
SMTP_HOST=localhost
SMTP_PORT=1025
APP_URL=http://localhost:3000
OWNER_NAME=Yuri Pereira
OWNER_EMAIL=
OWNER_PASSWORD=
TZ=America/Sao_Paulo
```

### Seed
- Super admin dono (dados do `.env`, `isOwner = true`, todas as permissões).
- Planos.
- Uma oficina de exemplo com master, 2 mecânicos, 1 financeiro, tabela de preços, estoque, clientes, veículos, agendamentos e OS em vários status — para testar todas as telas.

### Scripts esperados
`npm run start:dev`, `npm run test`, `npm run test:e2e`, `npm run lint`, `npx prisma migrate dev`, `npx prisma db seed`.

---

## 12. Fases de desenvolvimento

Cada fase termina com: testes passando, lint limpo, migração criada, Swagger atualizado e um resumo para mim.

| Fase | Entrega | Pronto quando |
| --- | --- | --- |
| **0. Base** | monorepo, docker-compose, NestJS, Prisma conectado, health check, ESLint/Prettier, Vitest, `.env.example`, seed do super admin | `docker compose up` + `start:dev` sobem e `/health` responde |
| **1. Auth e núcleo** | login dos 3 tipos, JWT + refresh, 2FA admins, guards de perfil/permissão, filtro de tenant, interceptor de auditoria, tratamento de erros | testes e2e de isolamento entre oficinas e de permissões passando |
| **2. Oficina** | cadastro/config da oficina, horários, usuários e permissões, tabela de preços, convites, cadastro do cliente por convite, veículos | cliente se cadastra por convite e aparece só na oficina certa |
| **3. Agendamento** | horários disponíveis, agendar/reagendar/cancelar, agenda por mecânico | não permite conflito de horário |
| **4. OS e orçamento** | OS, itens, origem da peça, link de afiliado, fotos, envio, aprovação por item, descontos e parâmetros, PDF, histórico do veículo | fluxo completo agendamento → OS → aprovação → conclusão |
| **5. Estoque** | peças, entradas, reservas, saídas, ajustes, alertas, despesa automática | reserva/baixa corretas e em transação |
| **6. Despesas** | lançamentos, categorias, recorrentes, salários, comprovantes, permissões `FINANCEIRO`/`VER_SALARIOS` | mecânico comum recebe 403 em tudo de despesas |
| **7. Dashboards** | endpoints agregados do master | números batem com os dados do seed |
| **8. Plataforma** | dashboard, gestão de oficinas/planos/usuários/admins, modo suporte, avisos, logs da plataforma | admin sem `FINANCEIRO` não vê valores |
| **9. Tickets** | abrir ticket com anexos, conversa, fila do admin | anexos salvos no storage S3 (SeaweedFS em dev) |
| **10. App Flutter** | login, shells por perfil, telas do cliente, mecânico, master, financeiro e plataforma, botão Suporte | app Android e Windows rodando contra a API local |
| **11. Notificações** | e-mail, push (FCM), lembretes, integração WhatsApp por oficina | lembrete de agendamento chega por push/e-mail |
| **12. Preparar deploy** | Dockerfile de produção, variáveis, backups do banco, build de release Android | imagem da API sobe numa VPS de teste |

### Em breve (não implementar agora, só deixar preparado)
- Pagamentos online (Pix, cartão, boleto) e cobrança automática das assinaturas.
- Versão iOS na App Store.
- Comissão automática do mecânico, lembrete de troca de óleo por km, mão de obra com preço por mecânico.

---

## 13. Convenções de código

- Código e nomes em **português** para domínio (ex.: `OrdemServico`, `agendamentos`), inglês aceitável para termos técnicos (`guard`, `service`).
- Um módulo NestJS por domínio; controllers finos, regra de negócio nos services.
- DTOs validados em toda entrada; nunca retornar `senhaHash`, tokens ou campos sensíveis sem permissão.
- Valores monetários sempre em centavos; formatar só na tela.
- Toda alteração de dado passa pelo service (para a auditoria registrar).
- Commits pequenos e descritivos, em português.
- Testes para toda regra de negócio da seção 7 e para permissões da seção 4.

---

## 14. Decisões tomadas durante o desenvolvimento

Registradas aqui para valer nas próximas fases.

| Tema | Decisão |
| --- | --- |
| Testes | Vitest + Supertest (NestJS 12 é só ESM). e2e rodam no banco `<banco>_test`. |
| Storage local | SeaweedFS (S3) no lugar do MinIO, que não publica mais imagens Docker. |
| AuditLog | Somente inserção garantida por trigger no banco (bloqueia UPDATE/DELETE/TRUNCATE). |
| Isolamento | `BancoService.tenant` (filtro automático de `oficinaId`) para rotas da oficina; `BancoService.sistema` para plataforma/cliente/público. Modelo novo com `oficinaId` deve entrar em `MODELOS_TENANT`. |
| Rotas | Toda rota não pública declara `@Atores(...)`; sem isso o acesso é negado. |
| Nova oficina | Autocadastro público (`POST /publico/oficinas`): oficina em TESTE por 14 dias + usuário MASTER + horários padrão. Admin também poderá criar (fase 8). |
| Limite do plano | Conta usuários ativos com perfil MASTER ou MECANICO (FINANCEIRO não conta). Excedeu → 422 `LIMITE_DO_PLANO`. |
| MASTER | Só existe pelo cadastro da oficina; não pode ser criado, desativado nem ter o perfil trocado pela API da oficina. |
| Veículos | O veículo é do cliente. A oficina só vê veículos vinculados a ela (`VeiculoOficina`), criado quando ela cadastra o veículo ou quando o cliente agenda/abre OS nela. |
| Tabela de preços | Todos os usuários da oficina consultam; MASTER ou GERENTE criam/editam/desativam. |
| Convites | Qualquer usuário da oficina gera; desativa: MASTER, GERENTE ou quem criou. Individual = 1 uso e 7 dias por padrão. Código de 6 caracteres sem 0/O/1/I/L. |
| Senhas | Mínimo 8 caracteres (dono da plataforma: 12). Senha inicial de usuário é definida pelo master; recuperação por e-mail fica para a fase 11. |
| Agendamento — serviço | O cliente descreve o serviço em texto livre; todo agendamento do cliente usa a duração padrão da oficina (`duracaoPadraoAgendamentoMin`, 60 min). A oficina pode informar outra duração. |
| Agendamento — grade | Horários oferecidos de `passoAgendaMin` em `passoAgendaMin` (30 min) a partir da abertura, sem cruzar o almoço nem o fechamento; o cliente agenda até `janelaAgendamentoDias` (60) à frente. A oficina pode marcar fora da grade, dentro do expediente. |
| Agendamento — capacidade | Um atendimento por mecânico ativo (master + mecânicos). Sem mecânico definido, o horário vale se houver mais mecânicos livres do que agendamentos sem mecânico sobrepostos. Reserva em transação com trava por oficina; o banco também impede o mesmo mecânico em horários sobrepostos (constraint de exclusão). |
| Agendamento — mecânico | O cliente não escolhe; a oficina atribui (MASTER/GERENTE qualquer um; mecânico comum só assume para si). Mecânico comum vê só a própria agenda. |
| Agendamento — status | Criado pelo cliente: AGENDADO; pela oficina: CONFIRMADO. Cliente reagenda/cancela até `antecedenciaCancelamentoHoras` antes (422 `PRAZO_ENCERRADO`); reagendar volta para AGENDADO. |
| Auditoria — nome da ação | `@Auditar({ acao, entidade })`: o nome vale só para a entidade principal; efeitos colaterais (ex.: vínculo do veículo) ficam com o nome padrão. |
| OS — recusa total | Se o cliente recusa todos os itens, a OS volta para EM_DIAGNOSTICO. Ao recusar uma peça, o cliente pode marcar "vou trazer a peça": entra um item "Peça trazida pelo cliente" (CLIENTE_COMPRA, não cobrado) no lugar. A oficina também pode fazer essa troca. |
| OS — alteração após envio | Qualquer alteração em itens depois do envio zera as respostas do cliente e a OS volta para EM_DIAGNOSTICO até ser reenviada. Cada envio pede a aprovação de todos os itens. Descontos não zeram as respostas (só reduzem o valor). Itens não mudam em EM_EXECUCAO. |
| OS — cancelamento | Cliente cancela até APROVADA (antes da execução). Oficina (mecânico da OS, gerente ou master) cancela em qualquer etapa não encerrada, com motivo obrigatório. O agendamento ligado é cancelado junto. |
| OS — visibilidade e edição | Mecânico sem GERENTE vê só as próprias OS (lista e detalhe), mas o histórico do veículo mostra todas as OS e agendamentos dele na oficina, de qualquer mecânico (sem custo). Alteram a OS: o mecânico dela, GERENTE ou MASTER. Pagamento na oficina: também FINANCEIRO. |
| OS — peças | Origem ESTOQUE só a partir da fase 5. CLIENTE_COMPRA não é cobrada (preço 0) e mostra o botão "Comprar peça" se houver link. Custo só é informado/visto por MASTER ou permissão FINANCEIRO. |
| OS — descontos | Mecânico sem permissão da oficina ou acima do limite: PENDENTE_APROVACAO (não reduz o total até MASTER/GERENTE aprovar). Limite em % é relativo à base do desconto (item ou subtotal). |
| OS — numeração | `Oficina.proximoNumeroOS` incrementado de forma atômica na abertura. |
| Arquivos | Imagens JPG/PNG/WEBP/HEIC até 10 MB, validadas pelos bytes. Bucket privado; leitura por URL assinada de 15 min. Até 30 fotos por OS. Exclusão lógica. |
| Estoque — custo | GERIR_ESTOQUE informa custo no cadastro e nas entradas, mas só MASTER ou permissão FINANCEIRO veem o custo (peça, movimentos e itens da OS). Custo da peça = custo médio ponderado, recalculado a cada entrada. |
| Estoque — reserva | Adicionar peça de ESTOQUE ao orçamento só confere o disponível (422 `ESTOQUE_INSUFICIENTE`, sugerindo trocar a origem); a reserva acontece na aprovação do cliente. Sem saldo na aprovação, o item fica PENDENTE ("a oficina vai ajustar") e a oficina troca a origem ou dá entrada. Alteração no orçamento, reenvio, remoção e cancelamento liberam reservas; a conclusão dá SAIDA. |
| Estoque — consistência | Saldo alterado por UPDATE condicional dentro da transação; entradas e ajustes travam a linha (`FOR UPDATE`). CHECKs no banco: quantidade ≥ 0 e 0 ≤ reservada ≤ quantidade. Peça com reserva não pode ser desativada nem ajustada abaixo do reservado. |
| Estoque — permissões | Todos os usuários da oficina consultam peças e movimentos (sem custo); cadastrar, editar, desativar, entrada e ajuste: MASTER ou GERIR_ESTOQUE. Item da tabela de preços pode ser ligado a uma peça do estoque (entra com origem ESTOQUE). |
| Despesa automática | Entrada de compra gera despesa na categoria "Peças" (padrão marcado), "a pagar" com vencimento (padrão hoje), ou "paga" se marcado. Toda oficina nasce com as categorias padrão da seção 7.6. |
| Despesas — acesso | Todas as rotas de `/oficina/despesas` exigem MASTER ou a **permissão** FINANCEIRO (o perfil FINANCEIRO sozinho não basta; GERENTE também não). |
| Despesas — salários | Categoria com `ehSalario`. Sem VER_SALARIOS (MASTER sempre vê) a pessoa não vê nada de salário: some de listas, somas, resumo, categorias e recorrentes; acesso direto dá 404; criar categoria de salário dá 403. Pagamento de funcionário: categoria de salários + funcionário da oficina + subtipo obrigatório. |
| Despesas — recorrentes | Job diário às 00:10 (São Paulo) gera a despesa do mês ("a pagar", vencimento no dia configurado; meses curtos usam o último dia), uma só por recorrente/competência. Cadastrada no meio do mês, gera o mês atual se o vencimento ainda não passou. Funcionário inativo e recorrente desativada não geram. Alterações valem para as próximas. |
| Despesas — outros | Exclusão lógica com motivo obrigatório. Categorias padrão não são renomeadas nem desativadas. Comprovantes: PDF ou imagem, até 10 MB, até 5 por despesa. Lembrete de contas a vencer (push/e-mail) fica para a fase 11; `GET /oficina/despesas/a-vencer` já entrega os dados. |
| Dashboard — definições | Faturamento = valor aprovado das OS **pagas** no período (regime de caixa). Ticket médio = faturamento ÷ OS pagas. Descontos = descontos aplicados nas OS pagas. Orçamentos aprovados × recusados = itens respondidos pelo cliente no período (sem "peça trazida pelo cliente"). "A receber" = OS concluídas ainda não pagas. Produtividade por mecânico = OS concluídas no período. Período padrão: do dia 1º do mês até hoje. |
| Dashboard — lucro | Lucro = faturamento do período − despesas com data no período (pagas ou a pagar). Sem VER_SALARIOS as despesas saem sem salários (`incluiSalarios: false`). O bloco financeiro ignora o filtro de mecânico (é sempre da oficina). |
| Dashboard — acesso | MASTER, GERENTE ou permissão FINANCEIRO; mecânico comum recebe 403. Bloco financeiro só MASTER ou FINANCEIRO (para os demais vem `null`). Exportação PDF/Excel com as mesmas regras e registrada na auditoria (`DASHBOARD_EXPORTADO`). |
| Seed | `SEED_OFICINA_NOME` cria outra oficina de exemplo; o teste do dashboard roda o seed real e confere os números. |
