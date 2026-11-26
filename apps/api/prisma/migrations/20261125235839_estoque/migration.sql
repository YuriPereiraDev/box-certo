-- CreateEnum
CREATE TYPE "TipoMovEstoque" AS ENUM ('ENTRADA', 'SAIDA', 'RESERVA', 'LIBERACAO_RESERVA', 'AJUSTE');

-- CreateEnum
CREATE TYPE "StatusDespesa" AS ENUM ('A_PAGAR', 'PAGO');

-- AlterTable
ALTER TABLE "ItemOrcamento" ADD COLUMN     "estoqueBaixado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estoqueReservado" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EstoqueItem" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codigo" TEXT,
    "marca" TEXT,
    "aplicacao" TEXT,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "quantidadeReservada" INTEGER NOT NULL DEFAULT 0,
    "custoCentavos" INTEGER NOT NULL DEFAULT 0,
    "precoVendaCentavos" INTEGER NOT NULL,
    "estoqueMinimo" INTEGER NOT NULL DEFAULT 0,
    "localizacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstoqueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentoEstoque" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "estoqueItemId" TEXT NOT NULL,
    "tipo" "TipoMovEstoque" NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "saldoQuantidade" INTEGER NOT NULL,
    "saldoReservada" INTEGER NOT NULL,
    "custoUnitarioCentavos" INTEGER,
    "fornecedor" TEXT,
    "notaFiscal" TEXT,
    "ordemServicoId" TEXT,
    "itemOrcamentoId" TEXT,
    "motivo" TEXT,
    "atorTipo" "TipoAtor" NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoriaDespesa" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ehSalario" BOOLEAN NOT NULL DEFAULT false,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoriaDespesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Despesa" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "formaPagamento" TEXT,
    "status" "StatusDespesa" NOT NULL,
    "vencimento" TIMESTAMP(3),
    "pagoEm" TIMESTAMP(3),
    "recorrenteId" TEXT,
    "funcionarioId" TEXT,
    "subtipoSalario" TEXT,
    "movimentoEstoqueId" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Despesa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstoqueItem_oficinaId_nome_idx" ON "EstoqueItem"("oficinaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "EstoqueItem_oficinaId_codigo_key" ON "EstoqueItem"("oficinaId", "codigo");

-- CreateIndex
CREATE INDEX "MovimentoEstoque_estoqueItemId_createdAt_idx" ON "MovimentoEstoque"("estoqueItemId", "createdAt");

-- CreateIndex
CREATE INDEX "MovimentoEstoque_oficinaId_createdAt_idx" ON "MovimentoEstoque"("oficinaId", "createdAt");

-- CreateIndex
CREATE INDEX "MovimentoEstoque_ordemServicoId_idx" ON "MovimentoEstoque"("ordemServicoId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaDespesa_oficinaId_nome_key" ON "CategoriaDespesa"("oficinaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Despesa_movimentoEstoqueId_key" ON "Despesa"("movimentoEstoqueId");

-- CreateIndex
CREATE INDEX "Despesa_oficinaId_data_idx" ON "Despesa"("oficinaId", "data");

-- CreateIndex
CREATE INDEX "Despesa_oficinaId_status_vencimento_idx" ON "Despesa"("oficinaId", "status", "vencimento");

-- AddForeignKey
ALTER TABLE "ItemOrcamento" ADD CONSTRAINT "ItemOrcamento_estoqueItemId_fkey" FOREIGN KEY ("estoqueItemId") REFERENCES "EstoqueItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstoqueItem" ADD CONSTRAINT "EstoqueItem_oficinaId_fkey" FOREIGN KEY ("oficinaId") REFERENCES "Oficina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoEstoque" ADD CONSTRAINT "MovimentoEstoque_estoqueItemId_fkey" FOREIGN KEY ("estoqueItemId") REFERENCES "EstoqueItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoriaDespesa" ADD CONSTRAINT "CategoriaDespesa_oficinaId_fkey" FOREIGN KEY ("oficinaId") REFERENCES "Oficina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Despesa" ADD CONSTRAINT "Despesa_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaDespesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Garantias no banco: saldo nunca negativo e reserva nunca maior que a quantidade.
ALTER TABLE "EstoqueItem" ADD CONSTRAINT "estoque_quantidade_nao_negativa" CHECK ("quantidade" >= 0);
ALTER TABLE "EstoqueItem" ADD CONSTRAINT "estoque_reserva_valida"
  CHECK ("quantidadeReservada" >= 0 AND "quantidadeReservada" <= "quantidade");
ALTER TABLE "ItemOrcamento" ADD CONSTRAINT "item_reserva_nao_negativa" CHECK ("estoqueReservado" >= 0);

-- Categorias padrão de despesa para as oficinas que já existem (seção 7.6).
INSERT INTO "CategoriaDespesa" ("id", "oficinaId", "nome", "ehSalario", "padrao")
SELECT gen_random_uuid(), o."id", c."nome", c."ehSalario", true
FROM "Oficina" o
CROSS JOIN (VALUES
  ('Aluguel', false), ('Energia', false), ('Água', false), ('Internet', false),
  ('Salários e funcionários', true), ('Peças', false), ('Ferramentas', false),
  ('Impostos', false), ('Manutenção', false), ('Outros', false)
) AS c("nome", "ehSalario")
ON CONFLICT ("oficinaId", "nome") DO NOTHING;
