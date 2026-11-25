-- CreateEnum
CREATE TYPE "OficinaStatus" AS ENUM ('TESTE', 'ATIVA', 'SUSPENSA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MASTER', 'MECANICO', 'FINANCEIRO');

-- CreateEnum
CREATE TYPE "PermissaoOficina" AS ENUM ('GERENTE', 'FINANCEIRO', 'VER_SALARIOS', 'GERIR_ESTOQUE', 'VER_LOGS');

-- CreateEnum
CREATE TYPE "TipoAtor" AS ENUM ('PLATAFORMA', 'USUARIO', 'CLIENTE', 'SISTEMA', 'SUPORTE');

-- AlterTable
ALTER TABLE "PlatformAdmin" ADD COLUMN     "totpAtivadoEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Oficina" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "cep" TEXT,
    "rua" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "status" "OficinaStatus" NOT NULL DEFAULT 'TESTE',
    "planoId" TEXT NOT NULL,
    "testeAte" TIMESTAMP(3),
    "precoFundadorCentavos" INTEGER,
    "mecanicoPodeDarDesconto" BOOLEAN NOT NULL DEFAULT false,
    "limiteDescontoPercentual" INTEGER,
    "limiteDescontoCentavos" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Oficina_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "senhaHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "permissoes" "PermissaoOficina"[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "dataNascimento" TIMESTAMP(3),
    "rg" TEXT,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "cep" TEXT,
    "rua" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "senhaHash" TEXT NOT NULL,
    "consentimentoLgpdEm" TIMESTAMP(3) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClienteOficina" (
    "clienteId" TEXT NOT NULL,
    "oficinaId" TEXT NOT NULL,
    "conviteId" TEXT,
    "observacoesInternas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClienteOficina_pkey" PRIMARY KEY ("clienteId","oficinaId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "oficinaId" TEXT,
    "atorTipo" "TipoAtor" NOT NULL,
    "atorId" TEXT,
    "atorNome" TEXT,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT,
    "antes" JSONB,
    "depois" JSONB,
    "motivo" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "origem" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "atorTipo" "TipoAtor" NOT NULL,
    "atorId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),
    "substituidoPor" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Oficina_status_idx" ON "Oficina"("status");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_oficinaId_email_key" ON "User"("oficinaId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_cpf_key" ON "Cliente"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_email_key" ON "Cliente"("email");

-- CreateIndex
CREATE INDEX "ClienteOficina_oficinaId_idx" ON "ClienteOficina"("oficinaId");

-- CreateIndex
CREATE INDEX "AuditLog_oficinaId_createdAt_idx" ON "AuditLog"("oficinaId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entidade_entidadeId_idx" ON "AuditLog"("entidade", "entidadeId");

-- CreateIndex
CREATE INDEX "AuditLog_atorTipo_atorId_createdAt_idx" ON "AuditLog"("atorTipo", "atorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_acao_createdAt_idx" ON "AuditLog"("acao", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_hash_key" ON "RefreshToken"("hash");

-- CreateIndex
CREATE INDEX "RefreshToken_atorTipo_atorId_idx" ON "RefreshToken"("atorTipo", "atorId");

-- AddForeignKey
ALTER TABLE "Oficina" ADD CONSTRAINT "Oficina_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "Plano"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_oficinaId_fkey" FOREIGN KEY ("oficinaId") REFERENCES "Oficina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteOficina" ADD CONSTRAINT "ClienteOficina_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteOficina" ADD CONSTRAINT "ClienteOficina_oficinaId_fkey" FOREIGN KEY ("oficinaId") REFERENCES "Oficina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AuditLog é somente inserção: bloqueia UPDATE, DELETE e TRUNCATE no banco.
CREATE OR REPLACE FUNCTION audit_log_somente_insercao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog é somente inserção (% bloqueado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_bloqueia_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_somente_insercao();

CREATE TRIGGER audit_log_bloqueia_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_somente_insercao();
