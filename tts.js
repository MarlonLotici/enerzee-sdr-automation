const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const VOZ_PADRAO = 'pt-BR-AntonioNeural';

async function gerarAudioTTS(texto, voz = VOZ_PADRAO) {
    const tempFile = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);

    // 🔥 FIX: Usa python -m ao invés de binário direto
    const comando = `python3 -m edge_tts --voice "${voz}" --text "${texto.replace(/"/g, '\\"')}" --write-media "${tempFile}" --rate "+5%" --volume "+0%"`;

    return new Promise((resolve, reject) => {
        exec(comando, { timeout: 15000 }, async (error) => {
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