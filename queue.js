const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');

// Conexão com o Redis (usa a variável da Railway ou localhost para testes)
const redisConnection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null
});

// 1. Criamos as Filas
const filaMensagens = new Queue('FilaMensagensIA', { connection: redisConnection });
const filaScraper = new Queue('FilaScraperMaps', { connection: redisConnection });

// 2. Exportamos as filas para podermos adicionar itens nela de outros arquivos
module.exports = {
    filaMensagens,
    filaScraper,
    redisConnection
};