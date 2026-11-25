import { urlBancoTeste } from './banco-teste.js';

// Variáveis do processo têm prioridade sobre o .env no ConfigModule.
process.env.DATABASE_URL = urlBancoTeste();
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_LOGIN = '10000';
process.env.RATE_LIMIT_GERAL = '10000';
