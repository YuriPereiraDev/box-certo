# Box Certo

SaaS para oficinas mecânicas. A especificação completa está em [CLAUDE.md](CLAUDE.md).

## Estrutura

```
apps/api   API NestJS 12 + Prisma 7 (PostgreSQL)
apps/app   App Flutter (fase 10)
docs/      documentação
```

## Rodar localmente (Windows + Docker Desktop)

```powershell
copy .env.example .env      # preencha OWNER_EMAIL, OWNER_PASSWORD (≥ 12 caracteres), segredos JWT e ENCRYPTION_KEY
docker compose up -d        # postgres, seaweedfs (S3), mailpit
cd apps/api
npm install
npx prisma migrate dev      # aplica as migrações
npx prisma db seed          # cria planos e o super admin dono
npm run start:dev
```

| Serviço | Endereço |
| --- | --- |
| API | http://localhost:3000 |
| Health check | http://localhost:3000/health |
| Swagger | http://localhost:3000/docs |
| S3 (SeaweedFS) | http://localhost:9000 — bucket `box-certo` |
| Painel SeaweedFS | http://localhost:9333 |
| Mailpit (e-mails de dev) | http://localhost:8025 |

### Dados do seed (dev)

- Super admin dono: `OWNER_EMAIL` / `OWNER_PASSWORD`. No primeiro login a API pede para configurar o 2FA
  (`/auth/plataforma/2fa/configurar` → QR code no app autenticador → `/auth/plataforma/2fa/ativar`).
- Oficina de exemplo — senha `SEED_SENHA_USUARIOS` para todos:
  `master@`, `mecanico1@` (GERENTE), `mecanico2@`, `financeiro@` — todos `@oficina-exemplo.local` —
  e o cliente `cliente@exemplo.local`.

### Testes e2e

Rodam num banco separado (`<banco>_test`, ou `DATABASE_URL_TEST`), criado e migrado automaticamente.
O `AuditLog` é somente inserção, então os testes criam dados novos a cada execução em vez de limpar.

## Scripts da API (`apps/api`)

| Script | O que faz |
| --- | --- |
| `npm run start:dev` | API em modo watch |
| `npm run test` | testes unitários (Vitest) |
| `npm run test:e2e` | testes e2e (Vitest + Supertest; precisa do `docker compose up`) |
| `npm run lint` | ESLint + Prettier (zero avisos) |
| `npm run typecheck` | checagem de tipos |
| `npm run build` | build de produção em `dist/` |
| `npx prisma migrate dev` | cria/aplica migrações |
| `npx prisma db seed` | seed (idempotente) |
