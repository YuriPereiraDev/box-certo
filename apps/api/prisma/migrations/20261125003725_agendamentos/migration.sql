-- CreateEnum
CREATE TYPE "StatusAgendamento" AS ENUM ('AGENDADO', 'CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO', 'CANCELADO', 'NAO_COMPARECEU');

-- AlterTable
ALTER TABLE "Oficina" ADD COLUMN     "duracaoPadraoAgendamentoMin" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "janelaAgendamentoDias" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "passoAgendaMin" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "Agendamento" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "mecanicoId" TEXT,
    "tipoServico" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "status" "StatusAgendamento" NOT NULL DEFAULT 'AGENDADO',
    "observacaoCliente" TEXT,
    "observacaoOficina" TEXT,
    "criadoPorTipo" "TipoAtor" NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "canceladoEm" TIMESTAMP(3),
    "canceladoPorTipo" "TipoAtor",
    "motivoCancelamento" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agendamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agendamento_oficinaId_inicio_idx" ON "Agendamento"("oficinaId", "inicio");

-- CreateIndex
CREATE INDEX "Agendamento_mecanicoId_inicio_idx" ON "Agendamento"("mecanicoId", "inicio");

-- CreateIndex
CREATE INDEX "Agendamento_clienteId_inicio_idx" ON "Agendamento"("clienteId", "inicio");

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_oficinaId_fkey" FOREIGN KEY ("oficinaId") REFERENCES "Oficina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "Veiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_mecanicoId_fkey" FOREIGN KEY ("mecanicoId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Garantia no banco: o mesmo mecânico não pode ter dois agendamentos ativos sobrepostos.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Agendamento"
  ADD CONSTRAINT "agendamento_sem_conflito_mecanico"
  EXCLUDE USING gist (
    "mecanicoId" WITH =,
    tsrange("inicio", "fim", '[)') WITH &&
  )
  WHERE ("mecanicoId" IS NOT NULL AND "status" IN ('AGENDADO', 'CONFIRMADO', 'EM_ATENDIMENTO'));

ALTER TABLE "Agendamento" ADD CONSTRAINT "agendamento_fim_depois_inicio" CHECK ("fim" > "inicio");
