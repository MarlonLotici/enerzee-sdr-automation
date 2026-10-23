'use strict';
// ============================================================================
// 🎭 TOM DE VOZ ADAPTATIVO — áudios TTS (WhatsApp) espelham o tom do lead.
//
// Lead manda "kkk opa blz" → áudio descontraído (mais solto, expressivo, rápido).
// Lead manda "Prezados, gostaria de entender o contrato" → áudio sério (estável, sóbrio).
// Lead desconfiado/irritado → áudio empático (calmo, mais lento, acolhedor).
//
// Função PURA (sem LLM extra = sem latência/custo): combina a tag [CLIMA:X] que a
// IA já emite com sinais textuais da última mensagem do lead. A VOZ (voice_id) nunca
// muda — trocar de voz no meio da conversa soaria como outra pessoa. Muda só a
// entonação (voice_settings) e, no eleven_v3, uma audio tag de emoção.
// ============================================================================

const TONS = ['neutro', 'serio', 'descontraido', 'entusiasmado', 'empatico', 'direto'];

// voice_settings por tom (eleven_multilingual_v2 / flash):
// stability ↑ = mais contido/monótono; style ↑ = mais expressivo; speed 0.7–1.2.
const PRESETS = {
    neutro:       { stability: 0.50, similarity_boost: 0.75, style: 0.15, speed: 1.00 },
    serio:        { stability: 0.72, similarity_boost: 0.80, style: 0.05, speed: 0.97 },
    descontraido: { stability: 0.32, similarity_boost: 0.75, style: 0.45, speed: 1.06 },
    entusiasmado: { stability: 0.30, similarity_boost: 0.75, style: 0.55, speed: 1.08 },
    empatico:     { stability: 0.62, similarity_boost: 0.80, style: 0.25, speed: 0.92 },
    direto:       { stability: 0.55, similarity_boost: 0.75, style: 0.10, speed: 1.12 },
};

// eleven_v3: entende audio tags de emoção no texto e só aceita stability 0 / 0.5 / 1.
const TAGS_V3 = {
    neutro: '', serio: '[serious]', descontraido: '[cheerfully]',
    entusiasmado: '[excited]', empatico: '[warmly]', direto: '',
};
const STABILITY_V3 = { neutro: 0.5, serio: 1.0, descontraido: 0.0, entusiasmado: 0.0, empatico: 0.5, direto: 0.5 };

// [CLIMA:X] é texto livre da LLM — mapeia as famílias de palavras mais comuns.
const CLIMA_PARA_TOM = [
    [/desconfi|irrit|bravo|chatead|frustr|preocup|insegur|receos|cetic|negativ|hostil|dead/, 'empatico'],
    [/ocupad|apressad|corrid|impacient|sem_?tempo/, 'direto'],
    [/formal|seri|tecnic|analit|cauteloso|profission/, 'serio'],
    [/animad|empolgad|entusiasm|hot|quente|interessad|positiv|aberto/, 'entusiasmado'],
    [/descontra|informal|bem_?humor|amigav|simpatic|leve|brincalh/, 'descontraido'],
];

const _norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const RE_RISADA = /\b(k{3,}|(?:ha){2,}h?|(?:he){2,}|rs(?:rs)*|kkk+)\b|[😂🤣😅😆😄😁😜😎🤙👊🍻]/u;
const RE_GIRIA = /\b(opa|eae|eai|e ai|fala ai|blz|beleza|suave|show|top|massa|mano|cara|vei|vlw|valeu|tmj|firmeza|bora|tranquilo|de boa|sussa)\b/;
const RE_FORMAL = /\b(prezad[oa]s?|senhor[a]?|sr\.?|sra\.?|por gentileza|atenciosamente|cordialmente|gostaria de|solicito|venho por meio|contrato|clausula|cnpj|garantia|juridic)\b/;
const RE_TENSO = /\b(golpe|fraude|nao confio|desconfi|absurdo|ridicul|reclama|irritad|chato|pare de|nao pedi|spam|enganad|mentira|caro demais)\b|[😡😠🤬😤]/u;
const RE_PRESSA = /\b(sem tempo|to ocupad|estou ocupad|correria|rapidinho|resumindo|resume|direto ao ponto|depois falo|agora nao|em reuniao)\b/;
const RE_EMPOLGADO = /\b(quero sim|bora|perfeito|otimo|excelente|maravilh|adorei|show de bola|demais|vamos fechar|fechado)\b|!{2,}|[🔥🚀🤩🙌👏💪]/u;

/**
 * Decide o tom do próximo áudio.
 * @param {{ clima?: string|null, textoLead?: string|null }} sinais
 * @returns {string} um de TONS
 */
function detectarTomVoz({ clima = null, textoLead = null } = {}) {
    const t = _norm(textoLead);

    // 1. Tensão no texto do lead vence tudo: nunca responder irritação com voz animada.
    if (t && RE_TENSO.test(t)) return 'empatico';

    // 2. Clima declarado pela IA (leu a conversa inteira, não só a última msg).
    const c = _norm(clima);
    let tomClima = null;
    if (c && !/neutr/.test(c)) {
        for (const [re, tom] of CLIMA_PARA_TOM) {
            if (re.test(c)) { tomClima = tom; break; }
        }
    }
    if (tomClima === 'empatico') return 'empatico';

    // 3. Sinais textuais da última mensagem (espelhamento do registro dele).
    if (t) {
        if (RE_PRESSA.test(t)) return 'direto';
        if (RE_FORMAL.test(t)) return 'serio';
        const risada = RE_RISADA.test(t);
        const giria = RE_GIRIA.test(t);
        if (RE_EMPOLGADO.test(t) && !risada) return 'entusiasmado';
        if (risada || giria) return 'descontraido';
    }

    return tomClima || 'neutro';
}

/** voice_settings do ElevenLabs para o tom (ajustado às restrições do modelo). */
function configVozParaTom(tom, modelo = '') {
    const preset = PRESETS[tom] || PRESETS.neutro;
    if (/eleven_v3/.test(modelo)) {
        return { stability: STABILITY_V3[tom] ?? 0.5, similarity_boost: preset.similarity_boost, speed: preset.speed };
    }
    return { ...preset };
}

/** No eleven_v3 prefixa a audio tag de emoção; nos outros modelos devolve o texto intacto. */
function aplicarTagEmocao(texto, tom, modelo = '') {
    if (!/eleven_v3/.test(modelo)) return texto;
    const tag = TAGS_V3[tom];
    return tag ? `${tag} ${texto}` : texto;
}

module.exports = { TONS, PRESETS, detectarTomVoz, configVozParaTom, aplicarTagEmocao };
