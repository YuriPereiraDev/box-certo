-- CreateEnum
CREATE TYPE "TipoTicket" AS ENUM ('ERRO', 'SUGESTAO', 'DUVIDA');

-- CreateEnum
CREATE TYPE "StatusTicket" AS ENUM ('ABERTO', 'EM_ANALISE', 'RESPONDIDO', 'RESOLVIDO');

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "oficinaId" TEXT,
    "autorTipo" "TipoAtor" NOT NULL,
    "autorId" TEXT NOT NULL,
    "autorNome" TEXT NOT NULL,
    "tipo" "TipoTicket" NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "status" "StatusTicket" NOT NULL DEFAULT 'ABERTO',
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "atribuidoAId" TEXT,
    "contexto" JSONB,
    "primeiraRespostaEm" TIMESTAMP(3),
    "resolvidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMensagem" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "autorTipo" "TipoAtor" NOT NULL,
    "autorId" TEXT NOT NULL,
    "autorNome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "interna" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMensagem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_numero_key" ON "Ticket"("numero");

-- CreateIndex
CREATE INDEX "Ticket_status_prioridade_createdAt_idx" ON "Ticket"("status", "prioridade", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_autorTipo_autorId_createdAt_idx" ON "Ticket"("autorTipo", "autorId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_oficinaId_createdAt_idx" ON "Ticket"("oficinaId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketMensagem_ticketId_createdAt_idx" ON "TicketMensagem"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "TicketMensagem" ADD CONSTRAINT "TicketMensagem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

