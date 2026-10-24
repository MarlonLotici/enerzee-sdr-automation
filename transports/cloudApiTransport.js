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
 *   enviarAudio(config, jid, buffer, mimeType) -> { id, raw }   (upload + mensagem de voz)
 */

const DEFAULT_BASE_URL = 'https://graph.facebook.com/v20.0';

function _base(config) {
    return String(config?.baseUrl || process.env.CLOUD_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}
function _apiKey(config) {
    // Precedência: credencial da instância (multi-tenant, por WABA) → env global.
    // WA_TOKEN e CLOUD_API_KEY são sinônimos de env (WA_TOKEN é o nome usado no setup da Antix).
    // Deixar cloud_api_key NULL na instância faz o token vir SÓ do env — nunca persistido no banco.
    return config?.apiKey || process.env.WA_TOKEN || process.env.CLOUD_API_KEY || '';
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

// Sobe um binário pra Meta e devolve o media id (POST /{phone_number_id}/media, multipart).
// O cloud_base_url já inclui o phone_number_id, então é só `${base}/media`.
async function uploadMidia(config, buffer, mimeType, nomeArquivo = 'audio.ogg') {
    const apiKey = _apiKey(config);
    if (!apiKey) throw new Error('Cloud API (Meta) sem access token configurado (cloud_api_key).');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', new Blob([buffer], { type: mimeType }), nomeArquivo);
    const resp = await fetch(`${_base(config)}/media`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` }, // sem Content-Type: o fetch põe o boundary
        body: form,
    });
    let data = {};
    try { data = await resp.json(); } catch { /* corpo vazio/não-json */ }
    if (!resp.ok || !data?.id) {
        const msg = data?.error?.message || resp.statusText || 'sem media id';
        throw new Error(`Cloud API upload ${resp.status}: ${msg}`);
    }
    return data.id;
}

// Áudio como MENSAGEM DE VOZ (onda + play, igual gravado no app): .ogg/OPUS + voice:true.
// Se a Meta recusar o parâmetro `voice` (recurso que já esteve em allowlist), reenvia como
// áudio comum — o lead recebe o áudio de qualquer jeito, só sem o visual de voice note.
async function enviarAudio(config, jid, buffer, mimeType = 'audio/ogg') {
    const mediaId = await uploadMidia(config, buffer, mimeType);
    const payload = (voice) => ({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: _soDigitos(jid),
        type: 'audio',
        audio: voice ? { id: mediaId, voice: true } : { id: mediaId },
    });
    try {
        return await _post(config, payload(true));
    } catch (err) {
        if (!/voice|param/i.test(err.message)) throw err;
        console.warn(`⚠️ [CLOUD-API] Meta recusou voice:true (${err.message}) — reenviando como áudio comum.`);
        return _post(config, payload(false));
    }
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
        // Reação (👍 etc.): a Cloud API manda type:'reaction' com o emoji. Vira texto pra IA
        // interpretar no contexto (ex.: 👍 depois de "faz sentido marcar?" = sim) — antes caía em
        // "sem texto" e era ignorada.
        const reacao = msg.reaction?.emoji ? `(o lead reagiu com ${msg.reaction.emoji})` : '';
        const texto = msg.text?.body
            || msg.button?.text
            || msg.interactive?.button_reply?.title
            || msg.interactive?.list_reply?.title
            || msg.audio?.caption || msg.image?.caption || msg.video?.caption
            || reacao || '';
        // Mídia: a Cloud API entrega só um ID; o conteúdo é baixado à parte (ver baixarMidia).
        const midia = msg.audio || msg.voice || msg.video || msg.image || msg.document || null;
        return {
            // normaliza pro formato que o resto do motor espera (chaveia leads por whatsapp_id assim)
            remoteJid: `${_soDigitos(msg.from)}@s.whatsapp.net`,
            fromMe: false,                       // webhook só entrega mensagens RECEBIDAS
            msgId: msg.id || null,
            pushName: contato?.profile?.name || null,
            tipo: tipoMeta === 'text' ? 'conversation' : tipoMeta, // alinha 'text'→'conversation' (Baileys)
            texto,
            mediaId: midia?.id || null,
            mimeType: midia?.mime_type || null,
            raw: webhookBody,
        };
    } catch {
        return null;
    }
}

// Marca uma mensagem recebida como LIDA (os ✓✓ azuis). No Baileys isso era automático
// (sock.readMessages); na Cloud API precisa de um POST explícito. Fire-and-forget: falha não
// pode atrapalhar o fluxo de resposta. messageId = o wamid da mensagem do lead.
async function marcarComoLido(config, messageId) {
    if (!messageId) return;
    try {
        await fetch(`${_base(config)}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${_apiKey(config)}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
        });
    } catch (_) { /* silencioso de propósito */ }
}

// Raiz da Graph API SEM o phone_number_id (https://host/vXX.0) — usada por mídia e templates.
function _root(config) {
    const m = String(_base(config)).match(/^(https?:\/\/[^/]+\/v\d+\.\d+)/);
    return m ? m[1] : DEFAULT_BASE_URL;
}

// Templates APROVADOS da WABA (GET /{waba_id}/message_templates), já com o texto do corpo
// e a quantidade de variáveis {{n}} — é o que o cliente escolhe ao montar a campanha.
async function listarTemplates(config, wabaId) {
    const apiKey = _apiKey(config);
    if (!apiKey) throw new Error('Cloud API (Meta) sem access token configurado (cloud_api_key).');
    if (!wabaId) throw new Error('waba_id não configurado na instância.');
    const url = `${_root(config)}/${wabaId}/message_templates?status=APPROVED&limit=200&fields=name,language,status,category,components`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    let data = {};
    try { data = await resp.json(); } catch { /* corpo vazio */ }
    if (!resp.ok) throw new Error(`Cloud API templates ${resp.status}: ${data?.error?.message || resp.statusText}`);
    return (data?.data || [])
        .filter(t => !t.status || t.status === 'APPROVED')
        .map(t => {
            const corpo = (t.components || []).find(c => c.type === 'BODY')?.text || '';
            const nums = [...corpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => Number(m[1]));
            return {
                nome: t.name,
                idioma: t.language,
                categoria: t.category,
                texto: corpo,
                qtdVariaveis: nums.length ? Math.max(...nums) : 0,
                botoes: ((t.components || []).find(c => c.type === 'BUTTONS')?.buttons || []).map(b => b.text),
            };
        });
}

// Baixa uma mídia recebida (áudio/imagem/doc) da Cloud API.
// Passo 1: GET {graphRoot}/{mediaId} -> { url, mime_type }  (raiz SEM o phone_number_id)
// Passo 2: GET {url} com Bearer -> binário.
async function baixarMidia(config, mediaId) {
    const apiKey = _apiKey(config);
    // cloud_base_url inclui o phone_number_id; a mídia usa só https://host/vXX.0
    const root = _root(config);
    const r1 = await fetch(`${root}/${mediaId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const meta = await r1.json();
    if (!meta?.url) throw new Error('mídia sem url: ' + JSON.stringify(meta?.error || meta));
    const r2 = await fetch(meta.url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r2.ok) throw new Error('download da mídia falhou: HTTP ' + r2.status);
    const buf = Buffer.from(await r2.arrayBuffer());
    return { buffer: buf, mimeType: meta.mime_type || null };
}

module.exports = {
    enviarTexto,
    enviarTemplate,
    enviarAudio,
    uploadMidia,
    listarTemplates,
    baixarMidia,
    marcarComoLido,
    normalizarInbound,
    nome: 'official',
    implementado: true,
    DEFAULT_BASE_URL,
};
