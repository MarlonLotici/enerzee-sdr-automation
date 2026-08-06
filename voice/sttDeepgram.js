/**
 * STT STREAMING — Deepgram Live API (WebSocket puro, sem SDK).
 *
 * Por que Deepgram e não o Whisper/Groq já usado no WhatsApp (4_sdr.js):
 * o Whisper via Groq é batch (arquivo inteiro → transcrição) e não tem modo
 * streaming — inviável para ligação ao vivo. O Deepgram aceita os frames
 * μ-law 8kHz do Twilio Media Streams direto, sem transcodificar, e devolve
 * interim results + endpointing (fim de fala) com latência <300ms.
 *
 * Eventos entregues via callbacks:
 *  - onFalaDetectada()        → lead começou a falar (usado para barge-in)
 *  - onTranscricaoParcial(t)  → interim result (legenda ao vivo no painel)
 *  - onTranscricaoFinal(t)    → speech_final: frase completa, dispara o turno de IA
 *  - onErro(err)
 */

const WebSocket = require('ws');

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';

function criarSttStream({ onFalaDetectada, onTranscricaoParcial, onTranscricaoFinal, onErro } = {}) {
    if (!process.env.DEEPGRAM_API_KEY) {
        throw new Error('DEEPGRAM_API_KEY não configurada no .env');
    }

    const params = new URLSearchParams({
        encoding: 'mulaw',          // formato nativo do Twilio Media Streams
        sample_rate: '8000',
        channels: '1',
        model: 'nova-2',
        language: 'pt-BR',
        interim_results: 'true',
        smart_format: 'true',
        vad_events: 'true',         // emite SpeechStarted → barge-in
        endpointing: '400',         // ms de silêncio para considerar fim de fala
        utterance_end_ms: '1200',
    });

    const ws = new WebSocket(`${DEEPGRAM_URL}?${params}`, {
        headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
    });

    let aberto = false;
    // Áudio que chegou do Twilio antes do handshake do Deepgram completar
    const bufferPreConexao = [];
    // Acumula partes speech_final=false até fechar a frase
    let fragmentos = [];

    ws.on('open', () => {
        aberto = true;
        for (const chunk of bufferPreConexao) ws.send(chunk);
        bufferPreConexao.length = 0;
    });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === 'SpeechStarted') {
            onFalaDetectada?.();
            return;
        }

        if (msg.type === 'Results') {
            const alt = msg.channel?.alternatives?.[0];
            const texto = (alt?.transcript || '').trim();
            if (!texto) return;

            if (msg.is_final) {
                fragmentos.push(texto);
                // speech_final = Deepgram detectou pausa longa → frase encerrada
                if (msg.speech_final) {
                    const frase = fragmentos.join(' ').trim();
                    fragmentos = [];
                    if (frase) onTranscricaoFinal?.(frase);
                }
            } else {
                onTranscricaoParcial?.(texto);
            }
            return;
        }

        // UtteranceEnd cobre o caso de speech_final não disparar (ruído de linha)
        if (msg.type === 'UtteranceEnd' && fragmentos.length > 0) {
            const frase = fragmentos.join(' ').trim();
            fragmentos = [];
            if (frase) onTranscricaoFinal?.(frase);
        }
    });

    ws.on('error', (err) => {
        console.error('❌ [STT] Erro no stream Deepgram:', err.message);
        onErro?.(err);
    });

    return {
        /** Recebe Buffer μ-law cru (payload base64 do Twilio já decodificado) */
        enviarAudio(bufferMulaw) {
            if (aberto && ws.readyState === WebSocket.OPEN) {
                ws.send(bufferMulaw);
            } else if (!aberto) {
                bufferPreConexao.push(bufferMulaw);
            }
        },
        fechar() {
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'CloseStream' }));
                }
                ws.close();
            } catch { /* já fechado */ }
        },
    };
}

module.exports = { criarSttStream };
