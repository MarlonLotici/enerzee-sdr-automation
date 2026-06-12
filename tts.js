const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const execFilePromise = util.promisify(execFile);

const VOZ_PADRAO = 'pt-BR-DonatoNeural';

// Caminhos absolutos — garante que funcionam mesmo que o PATH do worker não inclua /app/venv/bin
const EDGE_TTS_BIN = process.env.EDGE_TTS_PATH || '/app/venv/bin/edge-tts';
const FFMPEG_BIN   = process.env.FFMPEG_PATH   || 'ffmpeg';

async function gerarAudioTTS(texto, voz = VOZ_PADRAO) {
    const idUnico = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tempMp3 = path.join(os.tmpdir(), `tts_${idUnico}.mp3`);
    const tempOgg = path.join(os.tmpdir(), `tts_${idUnico}.ogg`);

    // Humanização: pausas e vícios de linguagem naturais
    const textoHumanizado = texto
        .replace(/\?/g, '? ... ')
        .replace(/\./g, ', ... ')
        .replace(/!/g, ', ... ')
        .replace(/fatura/gi, 'fatura, né,')
        .replace(/energia/gi, 'energia, ... tipo,')
        .replace(/agendar/gi, 'dar uma olhadinha');

    // Limpeza: remove excesso de pontuação e caracteres que quebram shell
    const textoParaAudio = textoHumanizado
        .replace(/(,\s*){2,}/g, ', ')
        .replace(/(\.\.\.\s*){2,}/g, '... ')
        .replace(/\s+/g, ' ')
        .replace(/["`\\]/g, '')   // remove chars que quebram shell mesmo com execFile
        .replace(/\[.*?\]/g, '')  // remove tags internas: [ESTAGIO:N], [CLIMA:X], [QUEBRA]
        .trim();

    try {
        // execFile passa args como array — imune a shell injection (sem interpretação de $, backticks, etc.)
        await execFilePromise(EDGE_TTS_BIN, [
            '--voice', voz,
            '--text',  textoParaAudio,
            '--write-media', tempMp3,
            '--rate=-4%',
            '--volume=+0%'
        ], { timeout: 15000 });

        if (!fs.existsSync(tempMp3)) {
            throw new Error(`edge-tts não gerou o arquivo MP3 (${tempMp3})`);
        }

        // Converte para OGG/Opus — formato nativo de áudio do WhatsApp
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

        if (!fs.existsSync(tempOgg)) {
            throw new Error(`ffmpeg não gerou o arquivo OGG (${tempOgg})`);
        }

        const buffer = fs.readFileSync(tempOgg);
        fs.unlinkSync(tempMp3);
        fs.unlinkSync(tempOgg);

        console.log(`✅ [TTS] Áudio gerado: ${buffer.length} bytes | voz: ${voz}`);
        return buffer;

    } catch (error) {
        console.error('❌ [TTS] Falha ao gerar áudio:', error.message);
        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
        if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg);
        throw error;
    }
}

module.exports = { gerarAudioTTS };
