// Pausa humana (espelha lib/pausaHumana.js do backend): quando alguém da equipe responde pelo painel,
// a IA fica calada por PAUSA_HUMANA_MIN e volta sozinha na próxima mensagem do lead depois disso.
// Pausa MANUAL (botão "IA ATIVA/PAUSADA") é outra coisa: só volta quando reativar.
export const PAUSA_HUMANA_MIN = 15

// null = não está na pausa humana; 0 = janela acabou (volta na próxima msg do lead); n = minutos restantes
export function minutosParaIAVoltar(lead) {
    if (!lead?.is_paused || lead.manual_pause || !lead.last_human_interaction) return null
    const ts = new Date(lead.last_human_interaction).getTime()
    if (!Number.isFinite(ts)) return null
    const resta = ts + PAUSA_HUMANA_MIN * 60000 - Date.now()
    return resta > 0 ? Math.ceil(resta / 60000) : 0
}

export function rotuloPausa(lead) {
    const m = minutosParaIAVoltar(lead)
    if (m === null) return '⏸️ IA PAUSADA'
    return m > 0 ? `⏸️ IA VOLTA EM ${m} MIN` : '⏸️ IA VOLTA NA PRÓX. MSG'
}

// Texto do balão: troca os marcadores internos por um ícone legível.
export function textoDoBalao(content) {
    return String(content || '')
        .replace(/^\s*\[AUDIO_TTS\]\s*/i, '🎙️ ')
        .replace(/^\s*\(Áudio\)\s*/i, '🎙️ ')
}
