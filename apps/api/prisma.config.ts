import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// O .env fica na raiz do monorepo; um .env local em apps/api tem prioridade.
config({ path: ['.env', '../../.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
