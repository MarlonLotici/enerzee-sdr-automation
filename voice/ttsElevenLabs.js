/**
 * TTS STREAMING — ElevenLabs Flash, exclusivo para o canal de LIGAÇÃO.
 *
 * O tts.js (DashScope CosyVoice) continua intocado para os áudios de WhatsApp:
 * ele é batch (MP3 completo + ffmpeg), o que é aceitável num chat assíncrono mas
 * inviável ao telefone — cada turno teria segundos de silêncio morto. O ElevenLabs
 * Flash tem latência de primeira-amostra ~75-150ms e devolve μ-law 8kHz nativo
 * (output_format=ulaw_8000), exatamente o formato que o Twilio Media Streams
 * espera — nenhuma transcodificação no meio do turno de fala.
 *
 * Barge-in: sintetizarStream devolve um AbortController — o engine chama
 * .abort() quando o lead interrompe a fala da IA.
 */

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
// Voz default multilíngue; troque por uma voz pt-BR do catálogo via env ELEVENLABS_VOICE_ID
const VOZ_DEFAULT = '21m00Tcm4TlvDq8ikWAM';
const MODELO = 'eleven_flash_v2_5';

/**
 * Sintetiza `texto` em streaming, entregando chunks μ-law 8kHz via aoChunk(Buffer).
 * @returns {{ pronta: Promise<void>, abortar: () => void }}
 */
function sintetizarStream(texto, aoChunk) {
    if (!process.env.ELEVENLABS_API_KEY) {
        throw new Error('ELEVENLABS_API_KEY não configurada no .env');
    }

    const voiceId = process.env.ELEVENLABS_VOICE_ID || VOZ_DEFAULT;
    const controller = new AbortController();

    const pronta = (async () => {
        const res = await fetch(
            `${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream?output_format=ulaw_8000`,
            {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'xi-api-key': process.env.ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: texto,
                    model_id: MODELO,
                    // Estabilidade média-alta: telefone tolera mal artefatos de voz
                    voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.0 },
                }),
            }
        );

        if (!res.ok) {
            const corpo = await res.text().catch(() => '');
            throw new Error(`ElevenLabs HTTP ${res.status}: ${corpo.slice(0, 200)}`);
        }

        for await (const chunk of res.body) {
            if (controller.signal.aborted) break;
            aoChunk(Buffer.from(chunk));
        }
    })();

    return {
        pronta,
        abortar: () => controller.abort(),
    };
}

module.exports = { sintetizarStream };
