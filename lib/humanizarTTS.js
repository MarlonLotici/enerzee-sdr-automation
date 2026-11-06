'use strict';
/**
 * Prepara o texto de um áudio (TTS) pra soar natural.
 *
 * Bug 2026-11-05: todo "." virava vírgula ("…sem custo de salário, Como vocês…"). Sem ponto, a voz não
 * fecha a frase com tom de descida: o áudio terminava como quem ainda vai falar e a pergunta seguinte
 * parecia emendada. Agora o ponto FICA (é ele que dá a entonação de fim de frase) e o texto sempre
 * termina com pontuação final.
 */
function humanizarParaTTS(texto) {
    let t = String(texto || '')
        .replace(/\.{2,}|…/g, '. ')       // reticências → um ponto (pausa + fecha a frase)
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.!?;:])/g, '$1')   // sem espaço antes da pontuação
        .replace(/([.!?])(?=[^\s.!?])/g, '$1 ') // garante espaço depois do fim de frase
        .replace(/,\s*,/g, ',')
        .trim()
        .replace(/[,;:\s]+$/, '');         // não termina em vírgula/dois-pontos
    if (t && !/[.!?]$/.test(t)) t += '.';
    return t;
}

module.exports = { humanizarParaTTS };
