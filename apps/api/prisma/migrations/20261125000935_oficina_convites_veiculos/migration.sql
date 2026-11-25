-- CreateEnum
CREATE TYPE "TipoItem" AS ENUM ('PECA', 'MAO_DE_OBRA');

-- AlterTable
ALTER TABLE "Oficina" ADD COLUMN     "antecedenciaCancelamentoHoras" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "termosAceitosEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "HorarioFuncionamento" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "abre" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "intervaloInicio" TEXT,
    "intervaloFim" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HorarioFuncionamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Convite" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "individual" BOOLEAN NOT NULL DEFAULT false,
    "nome" TEXT,
    "telefone" TEXT,
    "expiraEm" TIMESTAMP(3),
    "usos" INTEGER NOT NULL DEFAULT 0,
    "maxUsos" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Convite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemTabelaPreco" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoItem" NOT NULL,
    "precoCentavos" INTEGER NOT NULL,
    "tempoEstimadoMin" INTEGER,
    "estoqueItemId" TEXT,
    "linkAfiliadoPadrao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemTabelaPreco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Veiculo" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "ano" INTEGER,
    "motor" TEXT,
    "cor" TEXT,
    "combustivel" TEXT,
    "chassi" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Veiculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VeiculoOficina" (
    "veiculoId" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VeiculoOficina_pkey" PRIMARY KEY ("veiculoId","oficinaId")
);

-- CreateIndex
CREATE UNIQUE INDEX "HorarioFuncionamento_oficinaId_diaSemana_key" ON "HorarioFuncionamento"("oficinaId", "diaSemana");

-- CreateIndex
CREATE UNIQUE INDEX "Convite_codigo_key" ON "Convite"("codigo");

-- CreateIndex
CREATE INDEX "Convite_oficinaId_createdAt_idx" ON "Convite"("oficinaId", "createdAt");

-- CreateIndex
CREATE INDEX "ItemTabelaPreco_oficinaId_nome_idx" ON "ItemTabelaPreco"("oficinaId", "nome");

-- CreateIndex
CREATE INDEX "Veiculo_placa_idx" ON "Veiculo"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "Veiculo_clienteId_placa_key" ON "Veiculo"("clienteId", "placa");

-- CreateIndex
CREATE INDEX "VeiculoOficina_oficinaId_idx" ON "VeiculoOficina"("oficinaId");

-- AddForeignKey
ALTER TABLE "ClienteOficina" ADD CONSTRAINT "ClienteOficina_conviteId_fkey" FOREIGN KEY ("conviteId") REFERENCES "Convite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HorarioFuncionamento" ADD CONSTRAINT "HorarioFuncionamento_oficinaId_fkey" FOREIGN KEY ("oficinaId") REFERENCES "Oficina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Convite" ADD CONSTRAINT "Convite_oficinaId_fkey" FOREIGN KEY ("oficinaId") REFERENCES "Oficina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTabelaPreco" ADD CONSTRAINT "ItemTabelaPreco_oficinaId_fkey" FOREIGN KEY ("oficinaId") REFERENCES "Oficina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Veiculo" ADD CONSTRAINT "Veiculo_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VeiculoOficina" ADD CONSTRAINT "VeiculoOficina_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "Veiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VeiculoOficina" ADD CONSTRAINT "VeiculoOficina_oficinaId_fkey" FOREIGN KEY ("oficinaId") REFERENCES "Oficina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
