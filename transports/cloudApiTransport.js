/**
 * TRANSPORTE: WhatsApp Cloud API OFICIAL — direto na META (sem 360dialog).
 *
 * Usado por instâncias com whatsapp_provider='official'. Imune a soft-ban (é canal
 * legítimo), mas: (a) abertura fria fora da janela de 24h exige TEMPLATE aprovado pela
 * Meta; (b) resposta dentro de 24h pode ser texto livre; (c) inbound chega por WEBHOOK
 * (não por socket) — o server.js recebe e chama normalizarInbound aqui.
 *
 * Vai DIRETO na Meta Cloud API (graph.facebook.com), autenticando por Bearer token —
 * mais barato que um BSP revendedor (360dialog etc.): a hospedagem da API é grátis, paga-se
 * só a conversa à Meta. Cada cliente tem a PRÓPRIA WABA/número/token (o nome verificado que
 * aparece no WhatsApp é o da empresa dele). config = { apiKey, baseUrl } vindo da instância:
 *   - cloud_api_key  = ACCESS TOKEN permanente da Meta (vai no header Authorization: Bearer)
 *   - cloud_base_url = URL do endpoint COM o phone number id, ex.:
 *                      https://graph.facebook.com/v20.0/123456789012345
 *
 * ⚠️ O cloud_base_url PRECISA incluir o {PHONE_NUMBER_ID} do número do cliente — a Meta
 * roteia o envio por esse id no path. O default abaixo é só a versão da graph API (sem id),
 * suficiente pra falhar com erro claro se a instância não setar o cloud_base_url.
 *
 * CONTRATO (compatível com baileysTransport):
 *   normalizarInbound(webhookBody) -> ObjetoNormalizado | null   (mesma forma do Baileys)
 *   enviarTexto(config, jid, texto) -> { id, raw }
 *   enviarTemplate(config, jid, nome, idioma, componentes) -> { id, raw }
 */

const DEFAULT_BASE_URL = 'https://graph.facebook.com/v20.0';

function _base(config) {
    return String(config?.baseUrl || process.env.CLOUD_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}
function _apiKey(config) {
    return config?.apiKey || process.env.CLOUD_API_KEY || '';
}
// Cloud API quer só os dígitos com DDI (ex.: 5511999999999), sem @s.whatsapp.net.
function _soDigitos(jid) {
    return String(jid || '').replace(/@.*/, '').replace(/\D/g, '');
}

async function _post(config, payload) {
    const apiKey = _apiKey(config);
    if (!apiKey) throw new Error('Cloud API (Meta) sem access token configurado (cloud_api_key).');
    const resp = await fetch(`${_base(config)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
    });
    let data = {};
    try { data = await resp.json(); } catch { /* corpo vazio/não-json */ }
    if (!resp.ok) {
        const msg = data?.error?.message || data?.errors?.[0]?.detail || data?.meta?.developer_message || resp.statusText;
        throw new Error(`Cloud API ${resp.status}: ${msg}`);
    }
    return { id: data?.messages?.[0]?.id || null, raw: data };
}

// Texto livre — válido só dentro da janela de 24h após a última mensagem do lead.
async function enviarTexto(config, jid, texto) {
    return _post(config, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: _soDigitos(jid),
        type: 'text',
        text: { preview_url: false, body: String(texto ?? '') },
    });
}

// Template aprovado — obrigatório para ABRIR conversa fria (fora da janela de 24h).
async function enviarTemplate(config, jid, nomeTemplate, idioma = 'pt_BR', componentes = []) {
    const template = { name: nomeTemplate, language: { code: idioma } };
    if (Array.isArray(componentes) && componentes.length) template.components = componentes;
    return _post(config, {
        messaging_product: 'whatsapp',
        to: _soDigitos(jid),
        type: 'template',
        template,
    });
}

// Converte o webhook (formato Meta Cloud API) no MESMO objeto normalizado do
// baileysTransport, pra reusar toda a esteira do motor sem mudar a lógica de negócio.
function normalizarInbound(webhookBody) {
    try {
        const value = webhookBody?.entry?.[0]?.changes?.[0]?.value;
        const msg = value?.messages?.[0];
        if (!msg) return null; // pode ser um evento de status (sent/delivered/read), não mensagem
        const contato = value?.contacts?.[0];
        const tipoMeta = msg.type;
        const texto = msg.text?.body
            || msg.button?.text
            || msg.interactive?.button_reply?.title
            || msg.interactive?.list_reply?.title
            || '';
        return {
            // normaliza pro formato que o resto do motor espera (chaveia leads por whatsapp_id assim)
            remoteJid: `${_soDigitos(msg.from)}@s.whatsapp.net`,
            fromMe: false,                       // webhook só entrega mensagens RECEBIDAS
            msgId: msg.id || null,
            pushName: contato?.profile?.name || null,
            tipo: tipoMeta === 'text' ? 'conversation' : tipoMeta, // alinha 'text'→'conversation' (Baileys)
            texto,
            raw: webhookBody,
        };
    } catch {
        return null;
    }
}

module.exports = {
    enviarTexto,
    enviarTemplate,
    normalizarInbound,
    nome: 'official',
    implementado: true,
    DEFAULT_BASE_URL,
};
