'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairTelefoneDescricao, eventoEhReuniao, tituloComEmoji, tituloSemEmojiStatus, digitosParaJids } = require('../lib/gcalParse');

test('extrairTelefoneDescricao: formatos reais do GoHighLevel', () => {
    // "Telefone: - (94) 98109-3362"
    assert.equal(extrairTelefoneDescricao('\n\n==========\n\nTelefone: - (94) 98109-3362\nE-mail: - x@y.com'), '94981093362');
    // "Phone:- (11) 97602-4571"
    assert.equal(extrairTelefoneDescricao('Phone:- (11) 97602-4571\nEmail:- a@b.com'), '11976024571');
    // sem telefone
    assert.equal(extrairTelefoneDescricao('só um texto qualquer'), null);
    assert.equal(extrairTelefoneDescricao(''), null);
    assert.equal(extrairTelefoneDescricao(null), null);
});

test('eventoEhReuniao: aceita evento com convidado externo e horário; rejeita "fechado"/all-day', () => {
    const organizador = 'marlon.lotici@reinoeducacao.com';
    const reuniao = {
        status: 'confirmed',
        start: { dateTime: '2026-08-11T14:00:00-03:00' },
        organizer: { email: organizador },
        attendees: [{ email: organizador, organizer: true }, { email: 'joao@gmail.com', displayName: 'João' }],
    };
    assert.equal(eventoEhReuniao(reuniao), true);

    // Bloco "fechado": all-day (sem dateTime) e sem convidado externo
    assert.equal(eventoEhReuniao({ status: 'confirmed', start: { date: '2026-08-11' }, organizer: { email: organizador } }), false);
    // Evento só com o próprio organizador
    assert.equal(eventoEhReuniao({ status: 'confirmed', start: { dateTime: '2026-08-11T10:00:00-03:00' }, organizer: { email: organizador }, attendees: [{ email: organizador, organizer: true }] }), false);
    // Cancelado
    assert.equal(eventoEhReuniao({ status: 'cancelled', start: { dateTime: '2026-08-11T10:00:00-03:00' }, attendees: [{ email: 'x@y.com' }] }), false);
});

test('tituloComEmoji/tituloSemEmojiStatus: idempotente, troca o selo sem duplicar', () => {
    assert.equal(tituloComEmoji('Análise de João', '❓'), '❓Análise de João');
    // já tinha ❓ → vira ✅ sem duplicar
    assert.equal(tituloComEmoji('❓Análise com Vicente', '✅'), '✅Análise com Vicente');
    assert.equal(tituloComEmoji('✅Análise de João . com Marlon', '❌'), '❌Análise de João . com Marlon');
    assert.equal(tituloSemEmojiStatus('✅ Análise de João'), 'Análise de João');
});

test('digitosParaJids: cobre variação do 9º dígito', () => {
    const jids = digitosParaJids('94981093362'); // 11 díg → 55+11=13
    assert.ok(jids.includes('5594981093362@s.whatsapp.net'));
    // 10 díg (DDD+8, sem 9) → base 12 + variação com 9
    const j2 = digitosParaJids('1132224444');
    assert.ok(j2.some(j => j.startsWith('55')));
    assert.deepEqual(digitosParaJids('123'), []); // curto demais
});
