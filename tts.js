const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Voz neural PT-BR masculina — soa natural e confiante
const VOZ_PADRAO = 'pt-BR-AntonioNeural';

// 🔥 FIX RAILWAY: edge-tts instalado via pip fica em /root/.local/bin
// No ambiente local sem Python, o TTS fica desabilitado (fallback para texto)
const EDGE_TTS_PATH = process.env.EDGE_TTS_BIN || '/root/.local/bin/edge-tts';

async function gerarAudioTTS(texto, voz = VOZ_PADRAO) {
    const tempFile = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);

    return new Promise((resolve, reject) => {
        execFile(EDGE_TTS_PATH, [
            '--voice', voz,
            '--text', texto,
            '--write-media', tempFile,
            '--rate', '+5%',
            '--volume', '+0%'
        ], { timeout: 15000 }, async (error) => {
            if (error) {
                console.error('❌ [TTS] Falha no edge-tts:', error.message);
                return reject(error);
            }

            try {
                const buffer = fs.readFileSync(tempFile);
                fs.unlinkSync(tempFile);
                resolve(buffer);
            } catch (e) {
                reject(e);
            }
        });
    });
}

module.exports = { gerarAudioTTS };