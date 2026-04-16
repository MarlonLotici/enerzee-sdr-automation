const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const execPromise = util.promisify(exec);

// 🎯 TROCA PARA DONATO: É a voz masculina mais natural do motor gratuito
const VOZ_PADRAO = 'pt-BR-DonatoNeural'; 

async function gerarAudioTTS(texto, voz = VOZ_PADRAO) {
    const idUnico = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tempMp3 = path.join(os.tmpdir(), `tts_${idUnico}.mp3`);
    const tempOgg = path.join(os.tmpdir(), `tts_${idUnico}.ogg`);

    // 🧠 1. "SUJEIRA" NEURAL (Para o Donato soar como o Marlon)
    // Adicionamos pausas e vícios de linguagem que homens usam no dia a dia
    const textoHumanizado = texto
        .replace(/\?/g, '? ... ')        // Pausa de dúvida
        .replace(/\./g, ', ... ')        // Pausa para respirar entre frases
        .replace(/!/g, ', ... ')         // Tira a empolgação de robô, deixa mais seco/real
        .replace(/fatura/gi, 'fatura, né,') 
        .replace(/energia/gi, 'energia, ... tipo,')
        .replace(/agendar/gi, 'dar uma olhadinha') // Linguagem mais informal
        .replace(/"/g, '\\"');

    // 🎙️ 2. AJUSTE DE CADÊNCIA (--rate)
    // Reduzi a velocidade para -4%. Isso dá um tom de voz mais calmo e "seguro", 
    // fugindo daquele ritmo acelerado de telemarketing.
    const cmdEdgeTTS = `edge-tts --voice "${voz}" --text "${textoHumanizado}" --write-media "${tempMp3}" --rate "-4%" --volume "+0%"`;
    
    try {
        await execPromise(cmdEdgeTTS, { timeout: 15000 });
        
        if (!fs.existsSync(tempMp3)) {
            throw new Error('Erro ao gerar MP3.');
        }

        // 3. Converte para OGG/Opus (Check azul no WhatsApp)
        const cmdFfmpeg = `ffmpeg -i "${tempMp3}" -c:a libopus -b:a 64k -vbr on -compression_level 10 -frame_duration 60 -application voip "${tempOgg}" -y`;
        await execPromise(cmdFfmpeg, { timeout: 10000 });

        const buffer = fs.readFileSync(tempOgg);
        
        fs.unlinkSync(tempMp3);
        fs.unlinkSync(tempOgg);
        
        console.log(`✅ [TTS-MARLON] Áudio Masculino gerado: ${buffer.length} bytes`);
        return buffer;

    } catch (error) {
        console.error('❌ [TTS] Falha:', error.message);
        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
        if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg);
        throw error;
    }
}

module.exports = { gerarAudioTTS };