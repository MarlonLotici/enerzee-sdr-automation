/**
 * TRANSPORTE: Baileys (WhatsApp não-oficial / whatsapp-web).
 *
 * É a implementação padrão e única em produção hoje. Este módulo isola o contato
 * com o objeto `sock` do Baileys para que a lógica de negócio (motor SDR, agentes)
 * não precise conhecer o formato cru do Baileys — abrindo caminho para plugar, no
 * futuro, um segundo transporte (Cloud API oficial) sem reescrever o motor.
 *
 * CONTRATO (todo transporte deve implementar):
 *   enviar(sock, jid, content)  -> Promise<sentMsg>   // envio primitivo (sem ACK-wait)
 *   normalizarInbound(rawMsg)   -> ObjetoNormalizado | null
 *
 * ObjetoNormalizado = {
 *   remoteJid: string|null,   // JID/telefone do outro lado
 *   fromMe:    boolean,       // true se a mensagem saiu do próprio número (operador/IA)
 *   msgId:     string|null,   // id único da mensagem (dedup)
 *   pushName:  string|null,   // nome exibido do contato
 *   tipo:      string|null,   // tipo da mensagem (conversation, imageMessage, ...)
 *   texto:     string,        // texto extraído (vazio para mídia pura)
 *   raw:       any,           // payload cru original (para acesso a mídia/vcard específicos)
 * }
 *
 * IMPORTANTE: `enviar` é um passthrough puro de `sock.sendMessage`. A lógica de
 * ACK/retry/soft-ban continua em `enviarMensagemIA` (4_sdr.js), que chama este
 * `enviar` como primitivo. Não mova a lógica de ACK para cá sem reavaliar — ela é
 * específica do comportamento do Baileys (RC13 fecha o socket após entregar).
 */

// Envio primitivo. `content` é o objeto do Baileys ({ text }, { audio, ptt }, etc.).
async function enviar(sock, jid, content) {
    return sock.sendMessage(jid, content);
}

// Extrai os campos de alto nível de uma mensagem recebida, sem que o chamador
// precise conhecer o formato cru do Baileys. Espelha 1:1 a extração que já era
// feita inline no handler messages.upsert / processarMensagem.
function normalizarInbound(msg) {
    if (!msg?.message) return null;
    const tipo = Object.keys(msg.message).find(
        (k) => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage'
    ) || Object.keys(msg.message)[0] || null;

    return {
        remoteJid: msg.key?.remoteJid || null,
        fromMe: !!msg.key?.fromMe,
        msgId: msg.key?.id || null,
        pushName: msg.pushName || null,
        tipo,
        texto: msg.message.conversation || msg.message.extendedTextMessage?.text || '',
        raw: msg,
    };
}

module.exports = { enviar, normalizarInbound, nome: 'baileys' };
