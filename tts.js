const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const VOZ_PADRAO = 'pt-BR-AntonioNeural';

async function gerarAudioTTS(texto, voz = VOZ_PADRAO) {
    const tempFile = path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);

    const comando = `python3 -m edge_tts --voice "${voz}" --text "${texto.replace(/"/g, '\\"')}" --write-media "${tempFile}" --rate "+5%" --volume "+0%"`;

    return new Promise((resolve, reject) => {
        exec(comando, { timeout: 15000 }, async (error, stdout, stderr) => {
            if (error) {
                console.error('❌ [TTS] Falha no edge-tts:', error.message);
                console.error('❌ [TTS] stderr:', stderr);
                return reject(error);
            }

            try {
                if (!fs.existsSync(tempFile)) {
                    throw new Error('Arquivo de áudio não foi gerado');
                }
                
                const buffer = fs.readFileSync(tempFile);
                fs.unlinkSync(tempFile);
                console.log(`✅ [TTS] Áudio gerado: ${buffer.length} bytes`);
                resolve(buffer);
            } catch (e) {
                console.error('❌ [TTS] Erro ao ler arquivo:', e.message);
                reject(e);
            }
        });
    });
}

module.exports = { gerarAudioTTS };