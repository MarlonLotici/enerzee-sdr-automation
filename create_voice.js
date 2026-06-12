/**
 * create_voice.js — Cria uma voz personalizada no DashScope (CosyVoice Voice Design)
 *
 * Uso:
 *   1. Edite VOICE_PROMPT abaixo descrevendo a voz da sua agente
 *   2. node create_voice.js
 *   3. Copie o Voice ID retornado e salve como QWEN_VOICE_ID no Railway
 *
 * Custo: gratuito para CosyVoice Voice Design
 */

require('dotenv').config();
const https = require('https');
const fs    = require('fs');

const API_KEY = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
if (!API_KEY) {
    console.error('❌  Defina QWEN_API_KEY no .env ou no ambiente antes de rodar.');
    process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// EDITE AQUI: descreva a voz da sua agente em inglês
// Dimensões úteis: gender, age, pitch, speed, emotion, tone, use case
// ─────────────────────────────────────────────────────────────────────────────
const VOICE_PROMPT = `
Young Brazilian woman, around 28 years old, warm and professional tone,
medium-fast speech rate, clear and pleasant articulation, slightly energetic
and confident, conversational sales style, suitable for B2B business conversations
`.trim();

const PREVIEW_TEXT = 'Oi, tudo bem? Vi que vocês podem estar pagando a mais na conta de energia. Você é quem cuida dessa parte?';

// ─────────────────────────────────────────────────────────────────────────────

const body = JSON.stringify({
    model: 'voice-enrollment',
    input: {
        action: 'create_voice',
        target_model: 'cosyvoice-v3.5-plus',
        voice_prompt: VOICE_PROMPT,
        preview_text: PREVIEW_TEXT,
        prefix: 'sdr_lorena'
    },
    parameters: {
        sample_rate: 24000,
        response_format: 'mp3'
    }
});

const options = {
    hostname: 'dashscope.aliyuncs.com',
    path: '/api/v1/services/audio/tts/customization',
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
    }
};

console.log('🎤  Criando voz personalizada no DashScope...\n');

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        if (res.statusCode !== 200) {
            console.error(`❌  Erro HTTP ${res.statusCode}:`, data);
            return;
        }
        const result = JSON.parse(data);
        const voiceId    = result?.output?.voice_id || result?.output?.voice;
        const previewB64 = result?.output?.preview_audio?.data;

        if (!voiceId) {
            console.error('❌  Resposta inesperada:', JSON.stringify(result, null, 2));
            return;
        }

        console.log('✅  Voz criada com sucesso!');
        console.log(`\n📋  Voice ID: ${voiceId}\n`);
        console.log('👉  Próximo passo: adicione no Railway:');
        console.log(`    QWEN_VOICE_ID = ${voiceId}\n`);

        // Salva o áudio de preview localmente para você ouvir
        if (previewB64) {
            const previewPath = 'preview_voz.mp3';
            fs.writeFileSync(previewPath, Buffer.from(previewB64, 'base64'));
            console.log(`🔊  Preview salvo em: ${previewPath} — ouça antes de usar em produção`);
        }
    });
});

req.on('error', (e) => console.error('❌  Erro na requisição:', e.message));
req.write(body);
req.end();
