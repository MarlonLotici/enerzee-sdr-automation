const { execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const util = require('util');
const axios = require('axios');
const execFilePromise = util.promisify(execFile);

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
const API_KEY    = process.env.ELEVENLABS_API_KEY;

// Mesmas env vars do voice/ttsElevenLabs.js (canal de ligação) — uma assinatura ElevenLabs
// serve os dois canais. Troque a voz via ELEVENLABS_VOICE_ID por uma do catálogo pt-BR.
const VOZ_PADRAO = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const MODELO     = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

async function gerarAudioTTS(texto, voz = null) {
    if (!API_KEY) throw new Error('[TTS] ELEVENLABS_API_KEY não configurada.');

    const vozFinal = voz || VOZ_PADRAO;
    const idUnico  = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tempMp3  = path.join(os.tmpdir(), `tts_${idUnico}.mp3`);
    const tempOgg  = path.join(os.tmpdir(), `tts_${idUnico}.ogg`);

    // Remove tags internas da IA antes de enviar ao TTS
    const textoParaAudio = texto
        .replace(/\[.*?\]/g, '')
        .replace(/["`\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!textoParaAudio) throw new Error('[TTS] Texto vazio após limpeza.');

    try {
        // Endpoint batch (não-streaming) — WhatsApp precisa do arquivo completo antes de enviar,
        // diferente do voice/ttsElevenLabs.js que faz streaming pro canal de ligação.
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${vozFinal}`,
            {
                text: textoParaAudio,
                model_id: MODELO,
                voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.0 }
            },
            {
                headers: {
                    'xi-api-key': API_KEY,
                    'Content-Type': 'application/json',
                    'Accept': 'audio/mpeg'
                },
                responseType: 'arraybuffer',
                timeout: 20000
            }
        );

        // Verifica se a resposta é áudio (binary) ou JSON de erro
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
            const err = JSON.parse(Buffer.from(response.data).toString());
            throw new Error(`ElevenLabs: ${err?.detail?.message || err?.message || JSON.stringify(err)}`);
        }

        fs.writeFileSync(tempMp3, Buffer.from(response.data));

        // Converte MP3 → OGG/Opus (formato obrigatório para PTT no WhatsApp)
        await execFilePromise(FFMPEG_BIN, [
            '-i', tempMp3,
            '-c:a', 'libopus',
            '-b:a', '64k',
            '-vbr', 'on',
            '-compression_level', '10',
            '-frame_duration', '60',
            '-application', 'voip',
            '-y', tempOgg
        ], { timeout: 10000 });

        if (!fs.existsSync(tempOgg)) throw new Error('ffmpeg não gerou o OGG.');

        const buffer = fs.readFileSync(tempOgg);
        fs.unlinkSync(tempMp3);
        fs.unlinkSync(tempOgg);

        console.log(`✅ [TTS] ElevenLabs → OGG: ${buffer.length} bytes | voz: ${vozFinal}`);
        return buffer;

    } catch (error) {
        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
        if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg);

        // Log detalhado para debug
        const status  = error.response?.status;
        const resData = error.response?.data
            ? Buffer.from(error.response.data).toString().substring(0, 300)
            : null;
        console.error(`❌ [TTS] Falha ElevenLabs${status ? ` HTTP ${status}` : ''}: ${error.message}`);
        if (resData) console.error(`❌ [TTS] Body: ${resData}`);
        throw error;
    }
}

module.exports = { gerarAudioTTS };
