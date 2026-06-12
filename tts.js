const { OpenAI } = require('openai');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const execFilePromise = util.promisify(execFile);

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

// Cliente apontado para o DashScope (Alibaba Cloud) — API 100% compatível com OpenAI SDK
const qwenTTS = new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

// Voz padrão — configure via env var QWEN_VOICE_ID após rodar create_voice.js
// Fallback: longxiaochun_v2 (voz feminina neural CosyVoice, funciona em pt-BR)
const VOZ_PADRAO = process.env.QWEN_VOICE_ID || 'longxiaochun_v2';

async function gerarAudioTTS(texto, voz = null) {
    if (!process.env.QWEN_API_KEY) throw new Error('[TTS] QWEN_API_KEY não configurada.');

    const vozFinal = voz || VOZ_PADRAO;
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
        // 1. Gera o MP3 via CosyVoice (suporta vozes customizadas criadas com create_voice.js)
        const mp3Response = await qwenTTS.audio.speech.create({
            model: 'cosyvoice-v3.5-plus',
            voice: vozFinal,
            input: textoParaAudio,
        });

        const mp3Buffer = Buffer.from(await mp3Response.arrayBuffer());
        fs.writeFileSync(tempMp3, mp3Buffer);

        // 2. Converte MP3 → OGG/Opus — formato obrigatório para PTT (nota de voz) no WhatsApp
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

        if (!fs.existsSync(tempOgg)) throw new Error('ffmpeg não gerou o arquivo OGG.');

        const buffer = fs.readFileSync(tempOgg);
        fs.unlinkSync(tempMp3);
        fs.unlinkSync(tempOgg);

        console.log(`✅ [TTS] Qwen3-TTS-Flash → OGG: ${buffer.length} bytes | voz: ${vozFinal}`);
        return buffer;

    } catch (error) {
        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
        if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg);
        const status = error.status || error.response?.status;
        const msg = status ? `HTTP ${status}` : error.message;
        console.error(`❌ [TTS] Falha Qwen: ${msg}`);
        throw error;
    }
}

module.exports = { gerarAudioTTS };
