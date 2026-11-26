'use strict';
/**
 * 🔌 CONECTAR WHATSAPP OFICIAL pelo painel (sem rodar SQL à mão).
 *
 * Antes, cada cliente novo na Cloud API exigia um UPDATE manual em instances (token + phone_number_id + waba_id,
 * ver db/enerzee_consultoria_api_oficial.sql). Aqui o painel manda os 3 dados, o servidor confere direto na Meta
 * ANTES de gravar e inscreve o app na WABA (é isso que faz o webhook do app passar a receber as mensagens desse
 * número; o webhook em si é do app e já aponta pro servidor, que roteia pelo phone_number_id).
 *
 * Ordem das checagens (cada uma devolve uma mensagem que um leigo entende):
 *   1. o token lê o número (GET /{phone_number_id})            → token ou ID do número errado
 *   2. o número pertence à WABA (GET /{waba_id}/phone_numbers) → ID da WABA errado
 *   3. [opcional] registra o número com o PIN (POST /{id}/register) → número ainda não registrado na Cloud API
 *   4. inscreve o app na WABA (POST /{waba_id}/subscribed_apps) → sem isso as mensagens não chegam
 *
 * fetchImpl é injetável pros testes (default: fetch global do Node 18+).
 */

const VERSAO_GRAPH = 'v25.0';
const RAIZ_GRAPH = 'https://graph.facebook.com';

const _digitos = (v) => String(v ?? '').replace(/\D/g, '');

// Limpa e valida o que veio do formulário. Devolve { ok, dados } ou { ok:false, erro }.
function limparCredenciais({ phoneNumberId, wabaId, token, pin } = {}) {
    const dados = {
        phoneNumberId: _digitos(phoneNumberId),
        wabaId: _digitos(wabaId),
        token: String(token ?? '').trim(),
        pin: _digitos(pin),
    };
    // Os IDs da Meta têm 15-16 dígitos; 55 + DDD + número (12-13 dígitos) é o telefone colado no lugar errado.
    if (dados.phoneNumberId.length < 10 || dados.phoneNumberId.length > 20 || /^55\d{10,11}$/.test(dados.phoneNumberId))
        return { ok: false, erro: 'ID do número inválido. É o "Identificação do número de telefone" (só números), não o telefone.' };
    if (dados.wabaId.length < 10 || dados.wabaId.length > 20)
        return { ok: false, erro: 'ID da conta do WhatsApp (WABA) inválido. Só números.' };
    if (dados.phoneNumberId === dados.wabaId)
        return { ok: false, erro: 'O ID do número e o ID da WABA são diferentes. Confira se não colou o mesmo nos dois campos.' };
    if (dados.token.length < 50 || /\s/.test(dados.token))
        return { ok: false, erro: 'Token inválido. Cole o token permanente do usuário do sistema inteiro, sem espaços.' };
    if (pin != null && String(pin).trim() !== '' && dados.pin.length !== 6)
        return { ok: false, erro: 'O PIN tem 6 dígitos. Deixe vazio se o número já está registrado.' };
    return { ok: true, dados };
}

const montarBaseUrl = (phoneNumberId, versao = VERSAO_GRAPH) => `${RAIZ_GRAPH}/${versao}/${phoneNumberId}`;

// Traduz os erros mais comuns da Graph API pra português de gente.
function traduzirErroMeta(erro, etapa) {
    const code = erro?.code;
    const msg = erro?.message || 'erro desconhecido';
    if (code === 190) return 'Token expirado ou inválido. Gere um token PERMANENTE do usuário do sistema (não o token temporário de 24h).';
    if (code === 10 || code === 200 || code === 294)
        return 'O token não tem permissão para esta conta. No Business Manager, atribua a conta do WhatsApp ao usuário do sistema com controle total e gere o token com whatsapp_business_management e whatsapp_business_messaging.';
    if (code === 100 && etapa === 'numero') return 'A Meta não achou esse ID de número com esse token. Confira o "Identificação do número de telefone".';
    if (code === 100 && etapa === 'waba') return 'A Meta não achou essa WABA com esse token. Confira o ID da conta do WhatsApp.';
    if (etapa === 'registro') return `A Meta recusou o registro do número (${msg}). Se o número tem verificação em duas etapas, use o mesmo PIN dela.`;
    return `A Meta recusou (${msg}).`;
}

async function _graph(fetchImpl, metodo, caminho, token, corpo, versao) {
    const resp = await fetchImpl(`${RAIZ_GRAPH}/${versao}/${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
    let data = {};
    try { data = await resp.json(); } catch { /* corpo vazio */ }
    return { ok: resp.ok && !data?.error, data };
}

/**
 * Confere as credenciais na Meta e inscreve o app na WABA. Não grava nada.
 * @returns {Promise<{ok:true, numero, nome, qualidade, registrado:boolean} | {ok:false, etapa, erro}>}
 */
async function validarEInscrever({ phoneNumberId, wabaId, token, pin = '' }, { fetchImpl = fetch, versao = VERSAO_GRAPH } = {}) {
    const g = (metodo, caminho, corpo) => _graph(fetchImpl, metodo, caminho, token, corpo, versao);

    const num = await g('GET', `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
    if (!num.ok) return { ok: false, etapa: 'numero', erro: traduzirErroMeta(num.data?.error, 'numero') };

    const lista = await g('GET', `${wabaId}/phone_numbers?fields=id`);
    if (!lista.ok) return { ok: false, etapa: 'waba', erro: traduzirErroMeta(lista.data?.error, 'waba') };
    const ids = (lista.data?.data || []).map(n => String(n.id));
    if (!ids.includes(String(phoneNumberId)))
        return { ok: false, etapa: 'waba', erro: 'Esse número não pertence a essa conta do WhatsApp (WABA). Confira se os dois IDs são da mesma conta.' };

    let registrado = false;
    if (pin) {
        const reg = await g('POST', `${phoneNumberId}/register`, { messaging_product: 'whatsapp', pin });
        if (!reg.ok) return { ok: false, etapa: 'registro', erro: traduzirErroMeta(reg.data?.error, 'registro') };
        registrado = true;
    }

    const insc = await g('POST', `${wabaId}/subscribed_apps`);
    if (!insc.ok) return { ok: false, etapa: 'webhook', erro: `Credenciais certas, mas a inscrição do webhook falhou: ${traduzirErroMeta(insc.data?.error, 'webhook')}` };

    return {
        ok: true,
        numero: num.data?.display_phone_number || null,
        nome: num.data?.verified_name || null,
        qualidade: num.data?.quality_rating || null,
        registrado,
    };
}

/**
 * Teste de um chip já conectado (botão "Testar conexão"): o token ainda lê o número e o app segue inscrito na WABA.
 * @returns {Promise<{ok:boolean, numero?, nome?, qualidade?, inscrito?:boolean, erro?}>}
 */
async function testarConexao({ phoneNumberId, wabaId, token }, { fetchImpl = fetch, versao = VERSAO_GRAPH } = {}) {
    const g = (caminho) => _graph(fetchImpl, 'GET', caminho, token, null, versao);
    const num = await g(`${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
    if (!num.ok) return { ok: false, erro: traduzirErroMeta(num.data?.error, 'numero') };
    let inscrito = null; // null = não deu pra saber (sem WABA configurada)
    if (wabaId) {
        const insc = await g(`${wabaId}/subscribed_apps`);
        inscrito = insc.ok ? (insc.data?.data || []).length > 0 : false;
    }
    return {
        ok: inscrito !== false,
        numero: num.data?.display_phone_number || null,
        nome: num.data?.verified_name || null,
        qualidade: num.data?.quality_rating || null,
        inscrito,
        ...(inscrito === false ? { erro: 'O número responde, mas nenhum app está inscrito na WABA: as mensagens não vão chegar. Conecte de novo para reinscrever.' } : {}),
    };
}

module.exports = { VERSAO_GRAPH, limparCredenciais, montarBaseUrl, traduzirErroMeta, validarEInscrever, testarConexao };
