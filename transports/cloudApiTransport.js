/**
 * TRANSPORTE: WhatsApp Cloud API (oficial, Meta Graph API). — STUB / NÃO IMPLEMENTADO.
 *
 * Deixado pronto como ponto de extensão: clientes que preferirem pagar a API oficial
 * (imune a soft-ban, porém mais cara e com regras de template de 24h) poderão usar
 * este transporte selecionando `whatsapp_provider = 'official'` na instância, sem
 * que o motor SDR precise mudar.
 *
 * Para implementar no futuro, honrar o mesmo CONTRATO de baileysTransport.js:
 *   enviar(ctx, jid, content)  -> Promise<sentMsg>
 *   normalizarInbound(rawMsg)  -> ObjetoNormalizado | null
 *
 * Pontos de atenção conhecidos ao implementar:
 *   - Cloud API usa HTTP (POST /{phone_number_id}/messages), não um socket persistente.
 *     O parâmetro `ctx` aqui será o cliente HTTP/credenciais, não o `sock` do Baileys.
 *   - Não há presença/"digitando" nem read-receipts no mesmo modelo do Baileys.
 *   - Mensagens fora da janela de 24h exigem TEMPLATES pré-aprovados pela Meta.
 *   - O inbound chega por webhook (formato { entry: [{ changes: [{ value: { messages }}]}]}),
 *     bem diferente do evento messages.upsert do Baileys — normalizarInbound converte isso.
 */

const NAO_IMPLEMENTADO = 'Cloud API (whatsapp_provider="official") ainda não implementado — use "baileys".';

async function enviar() {
    throw new Error(NAO_IMPLEMENTADO);
}

function normalizarInbound() {
    throw new Error(NAO_IMPLEMENTADO);
}

module.exports = { enviar, normalizarInbound, nome: 'official', implementado: false };
