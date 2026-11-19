'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pareceRespostaAutomatica, ehMarcadaComoAutoresposta } = require('../lib/respostaAutomatica');

test('texto real do Lucas/ANSI (2026-11-18) é resposta automática', () => {
    const r = pareceRespostaAutomatica({
        texto: 'Agradecemos sua mensagem. Não estamos disponíveis no momento, mas entraremos em contato assim que possível.',
        segundosDesdeNossaFala: 4,
    });
    assert.equal(r.automatica, true);
});

test('saudação automática do WhatsApp Business (caso Andreia, 2026-11-05) é automática', () => {
    assert.equal(pareceRespostaAutomatica({ texto: 'Obrigado pelo contato. Para agendar, escolha o serviço e o horário por aqui' }).automatica, true);
    assert.equal(pareceRespostaAutomatica({ texto: 'Olá! Estamos fora do horário de atendimento. Nosso horário de atendimento é de seg a sex.' }).automatica, true);
});

test('menu numerado é automático', () => {
    assert.equal(pareceRespostaAutomatica({ texto: 'Digite 1 para vendas ou 2 para suporte' }).automatica, true);
});

test('sinal fraco sozinho só vale com resposta rápida', () => {
    assert.equal(pareceRespostaAutomatica({ texto: 'Entraremos em contato.', segundosDesdeNossaFala: 5 }).automatica, true);
    assert.equal(pareceRespostaAutomatica({ texto: 'Entraremos em contato.', segundosDesdeNossaFala: 180 }).automatica, false);
    assert.equal(pareceRespostaAutomatica({ texto: 'Entraremos em contato.' }).automatica, false);
});

test('dois sinais fracos juntos bastam mesmo sem tempo', () => {
    assert.equal(pareceRespostaAutomatica({ texto: 'Entraremos em contato em breve' }).automatica, true);
});

test('pessoa de verdade NÃO cai (negativos)', () => {
    const humanos = [
        'Obrigado pelo contato, quero saber o preço',
        'agora não estou disponível, me chama amanhã',
        'Oi',
        'Preciso melhorar o marketing da minha empresa',
        'Trabalhamos com engenharia elétrica',
        'ansi.engenharia@gmail.com',
        'amanha as 14;30',
        'claro',
    ];
    for (const texto of humanos) {
        assert.equal(pareceRespostaAutomatica({ texto, segundosDesdeNossaFala: 180 }).automatica, false, texto);
    }
});

test('mensagem longa nunca é tratada como robô; áudio e marcadores também não', () => {
    const longa = 'Agradecemos sua mensagem. ' + 'Contexto da conversa de gente. '.repeat(20);
    assert.equal(pareceRespostaAutomatica({ texto: longa }).automatica, false);
    assert.equal(pareceRespostaAutomatica({ texto: '(Áudio) agradecemos sua mensagem' }).automatica, false);
    assert.equal(pareceRespostaAutomatica({ texto: '[AUTORESPOSTA] agradecemos sua mensagem' }).automatica, false);
    assert.equal(pareceRespostaAutomatica({ texto: '' }).automatica, false);
    assert.equal(pareceRespostaAutomatica().automatica, false);
});

test('ehMarcadaComoAutoresposta reconhece o marcador compartilhado', () => {
    assert.equal(ehMarcadaComoAutoresposta('[AUTORESPOSTA] Agradecemos sua mensagem'), true);
    assert.equal(ehMarcadaComoAutoresposta('Agradecemos sua mensagem'), false);
    assert.equal(ehMarcadaComoAutoresposta(null), false);
});
