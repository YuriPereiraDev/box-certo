-- CreateEnum
CREATE TYPE "SubtipoSalario" AS ENUM ('SALARIO', 'VALE', 'COMISSAO', 'DECIMO_TERCEIRO', 'FERIAS', 'HORA_EXTRA', 'BENEFICIO');

-- AlterTable
ALTER TABLE "Despesa" ADD COLUMN     "competencia" TEXT,
ADD COLUMN     "excluidoPorId" TEXT,
ADD COLUMN     "motivoExclusao" TEXT,
ALTER COLUMN "subtipoSalario" TYPE "SubtipoSalario" USING "subtipoSalario"::"SubtipoSalario";

-- CreateTable
CREATE TABLE "DespesaRecorrente" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "diaVencimento" INTEGER NOT NULL,
    "funcionarioId" TEXT,
    "subtipoSalario" "SubtipoSalario",
    "formaPagamento" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DespesaRecorrente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DespesaRecorrente_oficinaId_ativa_idx" ON "DespesaRecorrente"("oficinaId", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "Despesa_recorrenteId_competencia_key" ON "Despesa"("recorrenteId", "competencia");

-- AddForeignKey
ALTER TABLE "Despesa" ADD CONSTRAINT "Despesa_recorrenteId_fkey" FOREIGN KEY ("recorrenteId") REFERENCES "DespesaRecorrente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Despesa" ADD CONSTRAINT "Despesa_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespesaRecorrente" ADD CONSTRAINT "DespesaRecorrente_oficinaId_fkey" FOREIGN KEY ("oficinaId") REFERENCES "Oficina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespesaRecorrente" ADD CONSTRAINT "DespesaRecorrente_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaDespesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespesaRecorrente" ADD CONSTRAINT "DespesaRecorrente_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

