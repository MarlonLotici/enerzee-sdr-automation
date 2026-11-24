/**
 * Gera amostras de áudio da Sofia com uma ou mais vozes do ElevenLabs, pra você ouvir e escolher.
 * Usa o MESMO modelo e a MESMA configuração de voz da produção (lib/tomVoz.js, tom "neutro").
 *
 * A chave do Railway só tem permissão de gerar áudio (não lista vozes), então o fluxo é:
 *   1) No site do ElevenLabs: Voices → Voice Library → filtre Português / Brazilian → ouça → "Add to my voices".
 *   2) Clique na voz e copie o Voice ID.
 *   3) Gere as amostras com a chave da produção (ela não aparece na tela):
 *        railway run -s enerzee-sdr-automation node scripts/amostras_voz.js <voiceId> [<voiceId> ...]
 *      Os MP3 ficam em docs/amostras_voz/ (cada um gasta ~170 caracteres da sua cota).
 *   4) Escolhida a voz: defina ELEVENLABS_VOICE_ID no Railway (vale pra todos os chips) ou grave o ID na
 *      coluna instances.tts_voice de um chip específico (vale só pra ele).
 *
 * Opcional: FRASE="outro texto" pra testar outra fala.
 */
const fs = require('fs');
const path = require('path');
const { configVozParaTom } = require('../lib/tomVoz');

const KEY = process.env.ELEVENLABS_API_KEY;
const MODELO = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
const FRASE = process.env.FRASE ||
    'Oi! Aqui é a Sofia, da Antix. Entendi o que você precisa: responder seus clientes na hora, até fora do horário. Faz sentido a gente marcar uma conversa rápida de trinta minutos?';

// Ajustes opcionais por env (VOZ_STABILITY, VOZ_STYLE, VOZ_SPEED) sobre o preset 'neutro' de produção; SUFIXO evita sobrescrever arquivos.
function ajustesDaVoz() {
    const base = configVozParaTom('neutro', MODELO);
    const n = (v) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
    const o = { stability: n(process.env.VOZ_STABILITY), style: n(process.env.VOZ_STYLE), speed: n(process.env.VOZ_SPEED) };
    for (const k of Object.keys(o)) if (o[k] !== undefined) base[k] = o[k];
    return base;
}

async function amostra(voiceId, pasta) {
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: FRASE, model_id: MODELO, voice_settings: ajustesDaVoz() }),
        signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
        const corpo = await resp.text().catch(() => '');
        const msg = (() => { try { return JSON.parse(corpo).detail?.message || corpo; } catch { return corpo; } })();
        throw new Error(`${resp.status} ${String(msg).slice(0, 180)}`);
    }
    const arquivo = path.join(pasta, `${voiceId}${process.env.SUFIXO ? '_' + process.env.SUFIXO : ''}.mp3`);
    fs.writeFileSync(arquivo, Buffer.from(await resp.arrayBuffer()));
    return arquivo;
}

(async () => {
    const ids = process.argv.slice(2).filter(Boolean);
    if (!KEY) { console.error('ELEVENLABS_API_KEY não encontrada. Rode com: railway run -s enerzee-sdr-automation node scripts/amostras_voz.js <voiceId>'); process.exit(1); }
    if (!ids.length) { console.error('Passe pelo menos um Voice ID. Veja as instruções no topo deste arquivo.'); process.exit(1); }
    const pasta = path.join(__dirname, '..', 'docs', 'amostras_voz');
    fs.mkdirSync(pasta, { recursive: true });
    console.log(`Modelo: ${MODELO} | frase (${FRASE.length} caracteres por voz): "${FRASE}"\n`);
    for (const id of ids) {
        try { console.log('✓', id, '→', await amostra(id, pasta)); }
        catch (e) { console.log('✗', id, '→', e.message); }
    }
})();
