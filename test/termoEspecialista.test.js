'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { termoEspecialista } = require('../lib/termoEspecialista');

test('prompt que fala em consultor → "consultor"; senão "especialista" (padrão antigo)', () => {
    assert.equal(termoEspecialista({ system_prompt: 'Marcar uma conversa com um consultor da Enerzee' }), 'consultor');
    assert.equal(termoEspecialista({ system_prompt: 'Você é a Sofia, da Antix.' }), 'especialista');
    assert.equal(termoEspecialista({}), 'especialista');
    assert.equal(termoEspecialista(null), 'especialista');
});
