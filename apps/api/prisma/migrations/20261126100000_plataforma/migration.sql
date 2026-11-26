-- AlterTable
ALTER TABLE "Oficina" ADD COLUMN     "canceladaEm" TIMESTAMP(3),
ADD COLUMN     "motivoStatus" TEXT,
ADD COLUMN     "statusAlteradoEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SessaoSuporte" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "encerradaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessaoSuporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvisoGlobal" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvisoGlobal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessaoSuporte_adminId_createdAt_idx" ON "SessaoSuporte"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "SessaoSuporte_oficinaId_createdAt_idx" ON "SessaoSuporte"("oficinaId", "createdAt");

-- CreateIndex
CREATE INDEX "AvisoGlobal_ativo_inicio_idx" ON "AvisoGlobal"("ativo", "inicio");

