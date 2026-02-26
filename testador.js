require('dotenv').config();
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const Groq = require('groq-sdk');
const pino = require('pino');
const qrcode = require('qrcode-terminal'); // Importa o desenhador de QR

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const NUMERO_DO_SDR = '5546999201690@s.whatsapp.net'; 

const promptCliente = `
# 👤 SUA IDENTIDADE
Você é o "Seu João", 58 anos, dono de uma padaria em Santa Catarina.
Sua missão é ser um cliente desconfiado e difícil, mas que topa se o vendedor for bom.
Fale como um idoso: "ok", "não sei", "zap", letras minúsculas e sem frescura.
Não mande a foto da conta de luz de primeira.
`;

const historico = [{ role: 'system', content: promptCliente }];
let gavetaDeTextos = [];
let timerResposta = null;

async function iniciarSimulador() {
    const { state, saveCreds } = await useMultiFileAuthState('wpp_simulador');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Simulador Seu Joao", "Chrome", "1.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    // 🎯 ONDE A MÁGICA DO QR ACONTECE AGORA
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            console.log('⚡ [QR CODE] Escaneie abaixo para entrar como Seu João:');
            qrcode.generate(qr, { small: true }); // Desenha o QR no terminal
        }

        if (connection === 'open') {
            console.log('\n✅ [SEU JOÃO] Conectado! O ringue está pronto.');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        
        if (msg.key.remoteJid === NUMERO_DO_SDR && !msg.key.fromMe) {
            await sock.readMessages([msg.key]);
            const textoSDR = msg.message.conversation || msg.message.extendedTextMessage?.text || "[Mídia]";
            console.log(`\n🤖 [SDR MARLON]: ${textoSDR}`);

            gavetaDeTextos.push(textoSDR);
            clearTimeout(timerResposta);

            timerResposta = setTimeout(async () => {
                const textoConsolidado = gavetaDeTextos.join(' | ');
                gavetaDeTextos = [];

                historico.push({ role: 'user', content: textoConsolidado });
                console.log(`\n🧠 [SEU JOÃO] Pensando na resposta...`);

                try {
                    const chat = await groq.chat.completions.create({
                        messages: historico,
                        model: "llama-3.3-70b-versatile",
                        temperature: 0.8,
                    });

                    const respostaCliente = chat.choices[0].message.content;
                    historico.push({ role: 'assistant', content: respostaCliente });
                    
                    await sock.sendPresenceUpdate('composing', NUMERO_DO_SDR);
                    setTimeout(async () => {
                        console.log(`👨‍🍳 [SEU JOÃO]: ${respostaCliente}`);
                        await sock.sendMessage(NUMERO_DO_SDR, { text: respostaCliente });
                    }, 4000);

                } catch (e) {
                    console.log("❌ Erro na IA do João:", e.message);
                }
            }, 8000);
        }
    });
}

iniciarSimulador();