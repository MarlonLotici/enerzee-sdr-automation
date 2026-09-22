/**
 * SELETOR DE TRANSPORTE por instância.
 *
 * O motor pergunta a este módulo qual transporte usar com base no campo
 * `whatsapp_provider` da instância (default 'baileys'). Ambos implementados:
 * 'baileys' (WhatsApp Web) e 'official'/'cloud'/'cloud_api' (Meta Cloud API,
 * via cloudApiTransport — envio por Bearer token + inbound por webhook).
 *
 * Uso:
 *   const { getTransport } = require('./transports');
 *   const transporte = getTransport(instanceData.whatsapp_provider);
 *   await transporte.enviar(sock, jid, { text });
 */

const baileysTransport = require('./baileysTransport');
const cloudApiTransport = require('./cloudApiTransport');

function getTransport(provider) {
    switch (provider) {
        case 'official':
        case 'cloud':
        case 'cloud_api':
            return cloudApiTransport;
        case 'baileys':
        default:
            return baileysTransport;
    }
}

module.exports = { getTransport, baileysTransport, cloudApiTransport };
