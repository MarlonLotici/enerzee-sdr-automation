const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const execPromise = util.promisify(exec);

const VOZ_PADRAO = 'pt-BR-AntonioNeural';

async function gerarAudioTTS(texto, voz = VOZ_PADRAO) {
    const idUnico = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tempMp3 = path.join(os.tmpdir(), `tts_${idUnico}.mp3`);
    const tempOgg = path.join(os.tmpdir(), `tts_${idUnico}.ogg`);

    // Como arrumamos o Nixpacks, o 'edge-tts' agora é um comando global válido
    const cmdEdgeTTS = `edge-tts --voice "${voz}" --text "${texto.replace(/"/g, '\\"')}" --write-media "${tempMp3}" --rate "+5%" --volume "+0%"`;
    
    try {
        // 1. Gera o MP3 base
        await execPromise(cmdEdgeTTS, { timeout: 15000 });
        
        if (!fs.existsSync(tempMp3)) {
            throw new Error('Arquivo MP3 não foi gerado pelo edge-tts.');
        }

        // 2. Converte para OGG/Opus (A Mágica para o WhatsApp aceitar como PTT)
        const cmdFfmpeg = `ffmpeg -i "${tempMp3}" -c:a libopus -b:a 64k -vbr on -compression_level 10 -frame_duration 60 -application voip "${tempOgg}" -y`;
        await execPromise(cmdFfmpeg, { timeout: 10000 });

        if (!fs.existsSync(tempOgg)) {
            throw new Error('Arquivo OGG não foi gerado pelo ffmpeg.');
        }

        // 3. Lê o buffer final
        const buffer = fs.readFileSync(tempOgg);
        
        // 4. Limpa o lixo (Anti-vazamento de memória)
        fs.unlinkSync(tempMp3);
        fs.unlinkSync(tempOgg);
        
        console.log(`✅ [TTS] Áudio Opus gerado: ${buffer.length} bytes`);
        return buffer;

    } catch (error) {
        console.error('❌ [TTS] Falha na geração/conversão:', error.message);
        // Limpeza de emergência em caso de erro
        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
        if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg);
        throw error;
    }
}

module.exports = { gerarAudioTTS };