/**
 * SMS SERVICE — Canal de reforço (smoke test) do pivot omnichannel.
 * Apenas infraestrutura por ora: a lógica de "disparar SMS se o lead não abriu
 * o email em 48h" ainda não existe e será acionada por um job futuro.
 */

const twilio = require('twilio');

// Cliente Twilio é LAZY: `twilio(sid, token)` lança erro se as credenciais estiverem
// vazias. Instanciar no topo do módulo derrubaria o processo no boot assim que algum
// código importasse este arquivo sem o Twilio configurado — a mesma classe de bug que
// o Resend causou. Só instancia (e só falha) na hora real de enviar um SMS.
let _twilioClient = null;
function getTwilioClient() {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        throw new Error('Credenciais Twilio (TWILIO_ACCOUNT_SID/AUTH_TOKEN) não configuradas.');
    }
    if (!_twilioClient) _twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    return _twilioClient;
}

function linkWhatsapp(ownerPhone) {
    const digitos = String(ownerPhone || '').replace(/\D/g, '');
    return `https://wa.me/55${digitos}`;
}

/**
 * Envia um SMS curto (limite 160 chars) com CTA para o WhatsApp do chip.
 * @param {string} telefone - dígitos do telefone destino, com DDI
 * @param {string} mensagem - texto do SMS (será truncado em 160 chars se necessário)
 * @returns {Promise<{success: boolean, messageId: string|null, error: string|null}>}
 */
async function enviarSMS(telefone, mensagem) {
    const digitos = String(telefone || '').replace(/\D/g, '');
    if (!digitos) {
        return { success: false, messageId: null, error: 'Telefone inválido' };
    }

    const texto = mensagem.length > 160 ? `${mensagem.slice(0, 157)}...` : mensagem;

    try {
        const msg = await getTwilioClient().messages.create({
            body: texto,
            from: process.env.TWILIO_FROM_NUMBER,
            to: `+${digitos}`,
        });

        console.log(`✅ [SMS] Enviado para +${digitos} (sid: ${msg.sid})`);
        return { success: true, messageId: msg.sid, error: null };
    } catch (err) {
        console.error(`❌ [SMS] Falha ao enviar para +${digitos}:`, err.message);
        return { success: false, messageId: null, error: err.message };
    }
}

module.exports = {
    enviarSMS,
    linkWhatsapp,
};
