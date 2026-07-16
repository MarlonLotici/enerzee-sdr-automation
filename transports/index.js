/**
 * SELETOR DE TRANSPORTE por instância.
 *
 * O motor pergunta a este módulo qual transporte usar com base no campo
 * `whatsapp_provider` da instância (default 'baileys'). Hoje só Baileys está
 * implementado; 'official' (Cloud API) é um stub que lança erro se selecionado.
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
