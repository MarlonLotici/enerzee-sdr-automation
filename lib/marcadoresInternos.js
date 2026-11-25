'use strict';
/**
 * Marcadores internos que o sistema grava no histórico (ex.: "[AUDIO_TTS] texto" depois de enviar um
 * áudio, "(Áudio) ..." na transcrição do lead). O modelo vê o histórico e às vezes COPIA o formato na
 * resposta — se ela sai como texto, o lead recebia "[AUDIO_TTS] E como vocês fazem…" literal.
 * Esta função tira esses marcadores do que vai pro cliente (texto e entrada do TTS).
 */
function removerMarcadoresInternos(texto) {
    return String(texto || '')
        .replace(/\[\s*[ÁA]UDIO[\s_-]*TTS\s*\]\s*:?\s*/gi, '')
        .replace(/\[\s*ATENDENTE[\s_-]*HUMANO\s*\]\s*:?\s*/gi, '')
        .replace(/^\s*\(\s*[ÁA]udio\s*\)\s*:?\s*/i, '')
        .trim();
}

// Etiquetas internas que a IA escreve ([ESTAGIO:3], [CLIMA:..], [ESCLARECENDO]...). UMA lista só, usada pelo WhatsApp (4_sdr.js)
// e pelo chat do site (webGuardrails.js): quando cada um tinha a sua, a etiqueta nova vazava pro visitante do site.
const NOMES_TAGS_INTERNAS = String.raw`ESTAGIO|ESTÁGIO|CLIMA|RAIO-X|PERFIL|ROBO|CONTADOR|ENGANO|GATEKEEPER|AGENDAMENTO_MANUAL|PAUSA\s*PARA\s*RESPOSTA|REVERSAO_TENTADA|FOLLOW_UP|AGUARDANDO_RETORNO|CONVERTIDO|ESCLARECENDO|AGENDAR`;
const regexTagsInternas = () => new RegExp(String.raw`\[\s*(` + NOMES_TAGS_INTERNAS + String.raw`)[^\]]*\]`, 'gi');

// [AGENDAR]: o modelo (seguindo o prompt do chip) pede os horários reais da agenda; o sistema executa e tira a tag.
const RE_TAG_AGENDAR = /\[\s*AGENDAR\s*\]/i;
const temTagAgendar = (texto) => RE_TAG_AGENDAR.test(String(texto || ''));
const tirarTagAgendar = (texto) => String(texto || '').replace(/\[\s*AGENDAR\s*\]/gi, '').replace(/[ \t]{2,}/g, ' ').trim();

module.exports = { removerMarcadoresInternos, regexTagsInternas, NOMES_TAGS_INTERNAS, temTagAgendar, tirarTagAgendar };
