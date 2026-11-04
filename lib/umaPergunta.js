'use strict';
// lib/umaPergunta.js — Trava "1 pergunta por mensagem" (função pura, testável sem subir o motor).
//
// O prompt proíbe empilhar perguntas, mas o LLM às vezes manda 2-3 de uma vez. A trava antiga
// cortava tudo depois do 1º "?" — e quando a resposta começava com cumprimento ("Oi, tudo bem? 😊
// Sou a Sofia da Antix... Como posso te chamar?") sobrava SÓ "Oi, tudo bem?" (bug real em
// 2026-11-02: lead de anúncio recebeu 2x um áudio "Oi, tudo bem?" e nenhuma apresentação).
// Agora pergunta de cumprimento não conta: corta só depois da 1ª pergunta DE VERDADE.

// "tudo bem?", "Oi Vini, tudo bem?", "Boa tarde! Como vai?" etc. — o trecho inteiro é cumprimento.
const RE_CUMPRIMENTO = /^(?:(?:oi+|ol[áa]|opa|e\s*a[íi]|eai|ei|hey|bom\s+dia|boa\s+tarde|boa\s+noite)[\s,!]*)?(?:[\p{L}]+[\s,!]+)?(?:tudo\s+(?:bem|bom|certo|tranquilo|joia|jóia|ok)|como\s+(?:vai|voc[êe]\s+est[áa]|vc\s+est[áa]|est[áa]|anda))\s*$/iu;

function ehCumprimento(trecho) {
    const limpo = String(trecho || '')
        .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '') // emojis
        .replace(/\s+/g, ' ')
        .trim();
    return limpo.length <= 40 && RE_CUMPRIMENTO.test(limpo);
}

// Posições (índice do "?") das perguntas que NÃO são cumprimento.
function perguntasReais(texto) {
    const s = String(texto || '');
    const posicoes = [];
    let inicio = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '?') {
            if (!ehCumprimento(s.slice(inicio, i))) posicoes.push(i);
            inicio = i + 1;
        } else if (c === '.' || c === '!' || c === '\n') {
            inicio = i + 1;
        }
    }
    return posicoes;
}

// Corta o texto depois da 1ª pergunta real quando há 2+. Com link (CTA de agendamento), não mexe.
function cortarPerguntasEmpilhadas(texto) {
    const s = String(texto || '');
    if (/https?:\/\//i.test(s)) return { texto: s, cortado: false, perguntas: 0 };
    const reais = perguntasReais(s);
    if (reais.length <= 1) return { texto: s, cortado: false, perguntas: reais.length };
    return { texto: s.slice(0, reais[0] + 1).trim(), cortado: true, perguntas: reais.length };
}

module.exports = { cortarPerguntasEmpilhadas, ehCumprimento, perguntasReais };
