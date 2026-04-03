const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Voz neural PT-BR masculina — soa natural e confiante
const VOZ_PADRAO = 'pt-BR-AntonioNeural';

async function gerarAudioTTS(texto, voz = VOZ_PADRAO) {
    const tempFile = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);

    return new Promise((resolve, reject) => {
        execFile('edge-tts', [
            '--voice', voz,
            '--text', texto,
            '--write-media', tempFile,
            '--rate', '+5%',   // ligeiramente mais rápido — soa mais natural em conversa
            '--volume', '+0%'
        ], { timeout: 15000 }, async (error) => {
            if (error) {
                console.error('❌ [TTS] Falha no edge-tts:', error.message);
                return reject(error);
            }

            try {
                const buffer = fs.readFileSync(tempFile);
                fs.unlinkSync(tempFile); // limpa o temp
                resolve(buffer);
            } catch (e) {
                reject(e);
            }
        });
    });
}

module.exports = { gerarAudioTTS };