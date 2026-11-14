'use strict';
/**
 * Prepara o texto de um áudio (TTS) pra soar natural.
 *
 * Bug 2026-11-05: todo "." virava vírgula ("…sem custo de salário, Como vocês…"). Sem ponto, a voz não
 * fecha a frase com tom de descida: o áudio terminava como quem ainda vai falar e a pergunta seguinte
 * parecia emendada. Agora o ponto FICA (é ele que dá a entonação de fim de frase) e o texto sempre
 * termina com pontuação final.
 *
 * Bug 2026-11-13: "conversa de 30 min" saiu no áudio como "30 mienei". O ElevenLabs lê abreviação
 * letra a letra ou inventa a pronúncia. Toda abreviação/sigla/símbolo vira palavra por extenso ANTES
 * de ir pra voz (expandirParaFala).
 */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
    'setembro', 'outubro', 'novembro', 'dezembro'];

const plural = (n, um, varios) => (Number(String(n).replace(',', '.')) === 1 ? um : varios);

// Abreviações de chat e de escrita → palavra falada. Casamento por palavra inteira, sem caixa.
const PALAVRAS = [
    ['vcs', 'vocês'], ['vc', 'você'], ['tbm', 'também'], ['tb', 'também'], ['pq', 'porque'],
    ['msgs', 'mensagens'], ['msg', 'mensagem'], ['obg', 'obrigado'], ['hj', 'hoje'], ['td', 'tudo'],
    ['tds', 'todos'], ['qdo', 'quando'], ['qto', 'quanto'], ['blz', 'beleza'], ['vlw', 'valeu'],
    ['dps', 'depois'], ['agr', 'agora'], ['cmg', 'comigo'], ['ctg', 'contigo'], ['ngm', 'ninguém'],
    ['mto', 'muito'], ['mt', 'muito'], ['mts', 'muitos'], ['q', 'que'], ['n', 'não'], ['tmj', 'tamo junto'],
    ['etc', 'e assim por diante'], ['kwh', 'quilowatt-hora'], ['km', 'quilômetros'], ['kg', 'quilos'],
];
// Com ponto ou barra no fim (não dá pra usar \b depois de "." ou "/").
const COM_PONTUACAO = [
    [/(^|\s)dra\.(?=\s|$)/gi, '$1doutora'], [/(^|\s)dr\.(?=\s|$)/gi, '$1doutor'],
    [/(^|\s)sra\.(?=\s|$)/gi, '$1senhora'], [/(^|\s)sr\.(?=\s|$)/gi, '$1senhor'],
    [/(^|\s)ex\.?:\s*/gi, '$1por exemplo, '], [/(^|\s)p\/(?=\s)/gi, '$1para'], [/(^|\s)c\/(?=\s)/gi, '$1com'],
    [/(^|\s)s\/(?=\s)/gi, '$1sem'], [/(^|\s)n[ºo°]\s?(?=\d)/gi, '$1número '], [/(^|\s)obs\.?:?\s*/gi, '$1observação: '],
];

function expandirParaFala(texto) {
    let t = String(texto || '');

    t = t.replace(/https?:\/\/\S+|www\.\S+/gi, 'o link')         // link lido em voz alta é ruído
        .replace(/\p{Extended_Pictographic}|️|‍/gu, '') // emoji não tem fala
        .replace(/\b24\s?\/\s?7\b/g, '24 horas por dia, todos os dias')
        .replace(/\b24h\b/gi, '24 horas');

    // Dinheiro: "R$ 597" → "597 reais"; "R$ 1.500,50" → "1.500 reais e 50 centavos".
    t = t.replace(/R\$\s?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/g, (_, inteiro, cent) => {
        const reais = `${inteiro} ${plural(inteiro.replace(/\./g, ''), 'real', 'reais')}`;
        return cent && cent !== '00' ? `${reais} e ${Number(cent)} ${plural(cent, 'centavo', 'centavos')}` : reais;
    });
    t = t.replace(/(\d+(?:,\d+)?)\s?%/g, '$1 por cento');

    // Horário: "14h30" → "14 horas e 30"; "14:30" → "14 e 30"; "14:00" → "14 horas"; "1h" → "1 hora".
    t = t.replace(/\b(\d{1,2})h(\d{2})\b/gi, (_, h, m) => `${h} ${plural(h, 'hora', 'horas')} e ${m}`);
    t = t.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, h, m) => (m === '00' ? `${h} ${plural(h, 'hora', 'horas')}` : `${h} e ${m}`));
    t = t.replace(/\b(\d+)\s?(?:h|hs|hrs?)\b\.?/gi, (_, h) => `${h} ${plural(h, 'hora', 'horas')}`);
    // Duração: "30 min", "30min", "1 min." → "30 minutos" / "1 minuto"; "15s"/"15 seg" → "15 segundos".
    t = t.replace(/\b(\d+)\s?(?:min|mins|minuto|minutos)\b\.?/gi, (_, n) => `${n} ${plural(n, 'minuto', 'minutos')}`);
    t = t.replace(/\b(\d+)\s?(?:s|seg|segs)\b\.?/gi, (_, n) => `${n} ${plural(n, 'segundo', 'segundos')}`);
    // Data: "16/11" → "16 de novembro" (só mês válido).
    t = t.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g, (orig, d, m) => (MESES[m - 1] && d >= 1 && d <= 31 ? `${Number(d)} de ${MESES[m - 1]}` : orig));
    // Multiplicação/parcelas: "3x" → "3 vezes".
    t = t.replace(/\b(\d+)\s?x\b/gi, (_, n) => `${n} ${plural(n, 'vez', 'vezes')}`);

    for (const [re, sub] of COM_PONTUACAO) t = t.replace(re, sub);
    for (const [abrev, palavra] of PALAVRAS) {
        // Borda própria: o \b do JS não enxerga letras acentuadas como parte da palavra.
        t = t.replace(new RegExp(`(^|[^\\p{L}\\d])${abrev}(?![\\p{L}\\d])`, 'giu'), `$1${palavra}`);
    }
    // Sigla "IA" (só maiúscula: "ia" minúsculo é o verbo "ir") soletrada, como se fala.
    t = t.replace(/(^|[^\p{L}])IAs?(?![\p{L}])/gu, '$1I A');
    return t;
}

function humanizarParaTTS(texto) {
    let t = expandirParaFala(texto)
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

module.exports = { humanizarParaTTS, expandirParaFala };
