const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const { execFile } = require('child_process');
const execFilePromise = util.promisify(execFile);
const axios = require('axios');

const FFMPEG_BIN   = process.env.FFMPEG_PATH || 'ffmpeg';
const ELEVEN_KEY   = process.env.ELEVENLABS_API_KEY;
// Voice ID padrão — substitua por um ID pt-BR da Voice Library do ElevenLabs
// Sugestão: filtre por "Portuguese (Brazil)" + "Conversational" em elevenlabs.io/voice-library
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || 'cgSgspJ2msm6clMCkdW9'; // "Jessica" multilingual

async function gerarAudioTTS(texto, voiceId = null) {
    if (!ELEVEN_KEY) throw new Error('[TTS] ELEVENLABS_API_KEY não configurada.');

    const vid = voiceId || ELEVEN_VOICE;
    const idUnico = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tempMp3 = path.join(os.tmpdir(), `tts_${idUnico}.mp3`);
    const tempOgg = path.join(os.tmpdir(), `tts_${idUnico}.ogg`);

    // Remove tags internas da IA antes de enviar ao TTS
    const textoParaAudio = texto
        .replace(/\[.*?\]/g, '')   // remove [ESTAGIO:N], [CLIMA:X], [QUEBRA], etc.
        .replace(/["`\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!textoParaAudio) throw new Error('[TTS] Texto vazio após limpeza.');

    try {
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${vid}`,
            {
                text: textoParaAudio,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.45,
                    similarity_boost: 0.80,
                    style: 0.15,
                    use_speaker_boost: true
                }
            },
            {
                headers: {
                    'xi-api-key': ELEVEN_KEY,
                    'Content-Type': 'application/json',
                    'Accept': 'audio/mpeg'
                },
                responseType: 'arraybuffer',
                timeout: 20000
            }
        );

        fs.writeFileSync(tempMp3, Buffer.from(response.data));

        // Converte MP3 → OGG/Opus (formato nativo de voz do WhatsApp)
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

        console.log(`✅ [TTS] ElevenLabs → OGG gerado: ${buffer.length} bytes | voice: ${vid}`);
        return buffer;

    } catch (error) {
        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
        if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg);
        // Log detalhado: se foi erro HTTP do ElevenLabs, mostra o status
        const status = error.response?.status;
        const msg = status ? `HTTP ${status} — ${error.response?.statusText}` : error.message;
        console.error(`❌ [TTS] Falha ElevenLabs: ${msg}`);
        throw error;
    }
}

module.exports = { gerarAudioTTS };
