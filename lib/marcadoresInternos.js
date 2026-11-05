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
        .replace(/^\s*\(\s*[ÁA]udio\s*\)\s*:?\s*/i, '')
        .trim();
}

module.exports = { removerMarcadoresInternos };
