-- CreateEnum
CREATE TYPE "OrigemPeca" AS ENUM ('ESTOQUE', 'COMPRADA_SEPARADO', 'CLIENTE_COMPRA');

-- CreateEnum
CREATE TYPE "StatusItemCliente" AS ENUM ('PENDENTE', 'APROVADO', 'RECUSADO');

-- CreateEnum
CREATE TYPE "StatusOS" AS ENUM ('ABERTA', 'EM_DIAGNOSTICO', 'ORCAMENTO_ENVIADO', 'APROVADA', 'EM_EXECUCAO', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoDesconto" AS ENUM ('PERCENTUAL', 'VALOR');

-- CreateEnum
CREATE TYPE "StatusDesconto" AS ENUM ('APLICADO', 'PENDENTE_APROVACAO', 'RECUSADO');

-- CreateEnum
CREATE TYPE "StatusPagamento" AS ENUM ('PENDENTE', 'PAGO_NA_OFICINA');

-- AlterTable
ALTER TABLE "Oficina" ADD COLUMN     "logoArquivoId" TEXT,
ADD COLUMN     "proximoNumeroOS" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "OrdemServico" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "agendamentoId" TEXT,
    "clienteId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "mecanicoId" TEXT NOT NULL,
    "status" "StatusOS" NOT NULL DEFAULT 'ABERTA',
    "kmEntrada" INTEGER,
    "combustivel" TEXT,
    "estadoVeiculo" TEXT,
    "diagnostico" TEXT,
    "observacoes" TEXT,
    "descontoTipo" "TipoDesconto",
    "descontoValor" INTEGER,
    "descontoStatus" "StatusDesconto",
    "descontoPorId" TEXT,
    "descontoMotivo" TEXT,
    "descontoEm" TIMESTAMP(3),
    "descontoDecididoPorId" TEXT,
    "statusPagamento" "StatusPagamento" NOT NULL DEFAULT 'PENDENTE',
    "formaPagamento" TEXT,
    "pagoEm" TIMESTAMP(3),
    "enviadoEm" TIMESTAMP(3),
    "aprovadoEm" TIMESTAMP(3),
    "iniciadoEm" TIMESTAMP(3),
    "concluidoEm" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),
    "canceladoPorTipo" "TipoAtor",
    "canceladoPorId" TEXT,
    "motivoCancelamento" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrdemServico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemOrcamento" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "ordemServicoId" TEXT NOT NULL,
    "tabelaPrecoId" TEXT,
    "descricao" TEXT NOT NULL,
    "tipo" "TipoItem" NOT NULL,
    "origemPeca" "OrigemPeca",
    "estoqueItemId" TEXT,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "precoUnitarioCentavos" INTEGER NOT NULL,
    "custoUnitarioCentavos" INTEGER,
    "linkAfiliado" TEXT,
    "descontoTipo" "TipoDesconto",
    "descontoValor" INTEGER,
    "descontoStatus" "StatusDesconto",
    "descontoPorId" TEXT,
    "descontoMotivo" TEXT,
    "descontoEm" TIMESTAMP(3),
    "descontoDecididoPorId" TEXT,
    "statusCliente" "StatusItemCliente" NOT NULL DEFAULT 'PENDENTE',
    "respondidoEm" TIMESTAMP(3),
    "substituiItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ItemOrcamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Arquivo" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT,
    "chave" TEXT NOT NULL,
    "nomeOriginal" TEXT,
    "mime" TEXT NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "enviadoPorTipo" "TipoAtor" NOT NULL,
    "enviadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Arquivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrdemServico_agendamentoId_key" ON "OrdemServico"("agendamentoId");

-- CreateIndex
CREATE INDEX "OrdemServico_oficinaId_status_idx" ON "OrdemServico"("oficinaId", "status");

-- CreateIndex
CREATE INDEX "OrdemServico_veiculoId_createdAt_idx" ON "OrdemServico"("veiculoId", "createdAt");

-- CreateIndex
CREATE INDEX "OrdemServico_mecanicoId_status_idx" ON "OrdemServico"("mecanicoId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrdemServico_oficinaId_numero_key" ON "OrdemServico"("oficinaId", "numero");

-- CreateIndex
CREATE INDEX "ItemOrcamento_ordemServicoId_idx" ON "ItemOrcamento"("ordemServicoId");

-- CreateIndex
CREATE INDEX "ItemOrcamento_oficinaId_idx" ON "ItemOrcamento"("oficinaId");

-- CreateIndex
CREATE UNIQUE INDEX "Arquivo_chave_key" ON "Arquivo"("chave");

-- CreateIndex
CREATE INDEX "Arquivo_entidade_entidadeId_idx" ON "Arquivo"("entidade", "entidadeId");

-- CreateIndex
CREATE INDEX "Arquivo_oficinaId_idx" ON "Arquivo"("oficinaId");

-- AddForeignKey
ALTER TABLE "OrdemServico" ADD CONSTRAINT "OrdemServico_oficinaId_fkey" FOREIGN KEY ("oficinaId") REFERENCES "Oficina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdemServico" ADD CONSTRAINT "OrdemServico_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "Agendamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdemServico" ADD CONSTRAINT "OrdemServico_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdemServico" ADD CONSTRAINT "OrdemServico_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "Veiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdemServico" ADD CONSTRAINT "OrdemServico_mecanicoId_fkey" FOREIGN KEY ("mecanicoId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemOrcamento" ADD CONSTRAINT "ItemOrcamento_ordemServicoId_fkey" FOREIGN KEY ("ordemServicoId") REFERENCES "OrdemServico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
