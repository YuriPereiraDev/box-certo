import { urlsBancoTeste } from './banco-teste.js';

// Variáveis do processo têm prioridade sobre o .env no ConfigModule.
const { app, migracao } = urlsBancoTeste();
process.env.DATABASE_URL = app; // a API e os fixtures usam o usuário restrito
process.env.DATABASE_URL_MIGRACAO = migracao; // seed (teste do dashboard) roda como dono
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_LOGIN = '10000';
process.env.RATE_LIMIT_GERAL = '10000';
