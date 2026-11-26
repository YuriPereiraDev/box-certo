-- Usuário de banco da API com o mínimo de privilégios (seção 9 e revisão de segurança).
-- As migrações rodam com o dono do banco; a API conecta com um usuário do grupo abaixo
-- (criado por `npm run db:usuario-app`).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boxcerto_app_grupo') THEN
    CREATE ROLE boxcerto_app_grupo NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO boxcerto_app_grupo;

-- Ler, inserir e alterar. Sem DELETE nem TRUNCATE em nenhuma tabela: exclusões são lógicas
-- (seção 5), e agora o próprio banco garante isso.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO boxcerto_app_grupo;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM boxcerto_app_grupo;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO boxcerto_app_grupo;

-- AuditLog: somente inserção (além do gatilho, que a API não consegue remover por não ser dona).
REVOKE UPDATE ON "AuditLog" FROM boxcerto_app_grupo;

-- Histórico de migrações: só leitura.
REVOKE INSERT, UPDATE ON "_prisma_migrations" FROM boxcerto_app_grupo;

-- Tabelas e sequências criadas por migrações futuras já nascem com as mesmas regras.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO boxcerto_app_grupo;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO boxcerto_app_grupo;
