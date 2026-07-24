/**
 * EMAIL SERVICE — Canal primário de prospecção fria (pivot omnichannel)
 * Substitui o disparo frio via WhatsApp/Baileys, que estava gerando soft-bans.
 * Usa Resend para envio e Groq (Llama 3.3) para personalização do copy.
 *
 * NEUTRO / MULTI-TENANT: nenhum vocabulário de nicho hardcoded. Toda a
 * personalização vem de um prompt DEDICADO a email (instanceData.email_prompt),
 * separado do system_prompt do WhatsApp — o fluxo de conversa do WA tem regras
 * (respostas curtas, [QUEBRA], etc.) que corromperiam a copy de email.
 * O mesmo serviço atende solar, educação, ou qualquer segmento sem alterar código.
 */

const { Resend } = require('resend');
const Groq = require('groq-sdk');
const db = require('./database'); // supressão de email + registro de histórico (canal email)

// Cliente do Resend é preguiçoso (lazy): o SDK lança erro na CONSTRUÇÃO se a API key
// estiver vazia, não só no envio. Instanciar no topo do módulo derrubava o processo
// inteiro no boot sempre que RESEND_API_KEY não estivesse configurada — mesmo em chips
// que nunca usam email. Agora só falha (de forma controlada, capturada pelo try/catch
// de quem chama) na hora real de enviar.
let _resendClient = null;
function getResend() {
    if (!process.env.RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY não configurada — envio de email indisponível.');
    }
    if (!_resendClient) _resendClient = new Resend(process.env.RESEND_API_KEY);
    return _resendClient;
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODELO_COPY = 'llama-3.3-70b-versatile';

// Limite de contexto do email_prompt injetado no gerador de copy — evita
// estourar tokens em tenants com prompts muito longos.
const MAX_CONTEXTO_TENANT = 1800;

function linkWhatsapp(ownerPhone, texto) {
    const digitos = String(ownerPhone || '').replace(/\D/g, '');
    return `https://wa.me/55${digitos}?text=${encodeURIComponent(texto)}`;
}

// Link de descadastro (LGPD). Aponta para o GET /unsubscribe do próprio servidor Express.
// Sem PUBLIC_BASE_URL configurado, retorna null e o email sai sem link (o header
// List-Unsubscribe também é omitido) — melhor não enviar link quebrado.
function linkDescadastro(email) {
    const base = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || '').replace(/\/$/, '');
    if (!base || !email) return null;
    return `${base}/unsubscribe?email=${encodeURIComponent(email)}`;
}

// Monta o payload do Resend com rodapé de descadastro visível + headers List-Unsubscribe
// (one-click, exigência de deliverability e boa prática LGPD). Sem link disponível, envia
// sem rodapé/header em vez de gerar um link quebrado.
function montarPayloadEmail(to, subject, corpo, fromOverride) {
    const unsub = linkDescadastro(to);
    const text = unsub
        ? `${corpo}\n\n—\nSe não quiser mais receber estes e-mails, cancele aqui: ${unsub}`
        : corpo;
    const payload = { from: fromOverride || process.env.EMAIL_FROM_ADDRESS, to, subject, text };
    if (unsub) {
        payload.headers = {
            'List-Unsubscribe': `<${unsub}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        };
    }
    return payload;
}

// Descrição curta e neutra do que o tenant oferece, para o CTA e o fallback.
// Deriva de product_type sem assumir setor específico.
function descricaoOferta(instanceData) {
    const pt = String(instanceData.product_type || '').trim();
    if (pt && pt.toLowerCase() !== 'solar') return pt;
    // 'solar' é o default histórico do banco; tratamos como não-informativo
    // para não contaminar tenants de outros nichos com linguagem de energia.
    return null;
}

function templateOutboundFallback(lead, instanceData) {
    const empresa = lead.name || 'sua empresa';
    const agente = instanceData.agent_name || 'Equipe Comercial';
    const companyName = instanceData.company_name || 'nossa empresa';
    const link = linkWhatsapp(instanceData.owner_phone, `Olá, recebi seu email da ${companyName}`);
    const cta = instanceData.calendly_link
        ? `Se preferir, pode agendar um horário direto na minha agenda: ${instanceData.calendly_link}`
        : `Fala com a gente pelo WhatsApp:\n${link}`;

    return {
        assunto: `${empresa}, uma oportunidade da ${companyName}`,
        corpo: `Olá,\n\nSou ${agente}, da ${companyName}. Gostaria de apresentar uma solução que pode fazer sentido para ${empresa}.\n\n${cta}\n\nAtenciosamente,\n${agente} — ${companyName}`,
    };
}

async function gerarCopyOutbound(lead, instanceData) {
    const empresa = lead.name || 'a empresa';
    const agente = instanceData.agent_name || 'Equipe Comercial';
    const companyName = instanceData.company_name || 'nossa empresa';
    const setor = lead.niche ? String(lead.niche).trim() : null;
    // Fonte da copy = email_prompt DEDICADO. Nunca cai no system_prompt do WhatsApp
    // (regras de conversa do WA gerariam um email quebrado). Sem email_prompt → genérico seguro.
    const contextoTenant = String(instanceData.email_prompt || '').slice(0, MAX_CONTEXTO_TENANT).trim();
    const link = linkWhatsapp(instanceData.owner_phone, `Olá, recebi seu email da ${companyName}`);

    const prompt = `Você é um copywriter B2B sênior. Escreva um email de prospecção fria curto (máx 120 palavras no corpo), personalizado e sem parecer spam.

Baseie a mensagem EXCLUSIVAMENTE no contexto do negócio abaixo. NÃO invente produtos, setores, números ou benefícios que não estejam descritos. Não assuma o segmento de quem envia — use apenas o que o contexto fornecer.

CONTEXTO DO NEGÓCIO DE QUEM ENVIA (fonte da verdade):
"""
${contextoTenant || 'Sem contexto detalhado. Escreva de forma consultiva e genérica, apresentando a empresa e convidando para uma conversa, sem citar produto específico.'}
"""

DADOS DO ENVIO:
- Empresa destinatária (lead): ${empresa}${setor ? `\n- Setor do lead: ${setor}` : ''}
- Nome do remetente (assinatura): ${agente}
- Empresa remetente: ${companyName}${instanceData.email_website_url ? `\n- Site oficial (cite se fizer sentido, sem inventar outro): ${instanceData.email_website_url}` : ''}
- Link de CTA OBRIGATÓRIO (inclua exatamente este link no corpo): ${link}

Retorne SOMENTE um JSON válido, sem markdown, sem texto adicional, no formato:
{"assunto": "...", "corpo": "..."}

O corpo deve ser texto simples (pode usar quebras de linha \\n), tom consultivo, e terminar com uma chamada clara para o WhatsApp via o link fornecido. Escreva em português do Brasil.`;

    const res = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: MODELO_COPY,
        temperature: 0.7,
        max_tokens: 500,
    });

    const raw = res.choices[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw);
    if (!parsed.assunto || !parsed.corpo) throw new Error('Copy do LLM incompleta');
    return parsed;
}

/**
 * Envia email de prospecção fria para um lead novo.
 * @param {Object} lead - precisa de: email, name, niche
 * @param {Object} instanceData - regras do chip (agent_name, company_name, owner_phone, email_prompt, product_type)
 * @returns {Promise<{success: boolean, messageId: string|null, error: string|null}>}
 */
async function enviarEmailOutbound(lead, instanceData) {
    if (!lead?.email) {
        return { success: false, messageId: null, error: 'Lead sem email' };
    }

    // 📭 Supressão (LGPD/bounce): nunca reenviar para quem descadastrou ou deu hard bounce.
    if (await db.isEmailSuprimido(lead.email)) {
        console.log(`📭 [EMAIL] ${lead.email} está na lista de supressão — envio bloqueado.`);
        return { success: false, messageId: null, error: 'Email suprimido' };
    }

    let copy;
    try {
        copy = await gerarCopyOutbound(lead, instanceData);
    } catch (errLLM) {
        console.error(`⚠️ [EMAIL] LLM falhou ao gerar copy para ${lead.name}, usando fallback:`, errLLM.message);
        copy = templateOutboundFallback(lead, instanceData);
    }

    try {
        const { data, error } = await getResend().emails.send(
            montarPayloadEmail(lead.email, copy.assunto, copy.corpo, instanceData.email_from_address)
        );

        if (error) {
            console.error(`❌ [EMAIL] Falha ao enviar outbound para ${lead.email}:`, error.message);
            return { success: false, messageId: null, error: error.message };
        }

        // Registra no histórico unificado (canal email) — ver Fase 4.
        db.saveMessage(lead.whatsapp_id || lead.email, 'assistant', `[EMAIL] ${copy.assunto}\n\n${copy.corpo}`, instanceData.id, instanceData.user_id, 'email').catch(() => {});

        console.log(`✅ [EMAIL] Outbound enviado para ${lead.email} (lead: ${lead.name})`);
        return { success: true, messageId: data?.id || null, error: null };
    } catch (err) {
        console.error(`❌ [EMAIL] Erro inesperado ao enviar para ${lead.email}:`, err.message);
        return { success: false, messageId: null, error: err.message };
    }
}

/**
 * Envia email de repasse quando um lead indica outra pessoa por email no chat.
 * Tom mais pessoal, menciona a indicação e traz o link do Calendly.
 * NEUTRO: não cita produto/segmento — descreve a oferta a partir de product_type
 * quando informativo, senão usa linguagem genérica.
 * @param {string} emailDestinatario
 * @param {Object} lead - lead original (quem fez o repasse)
 * @param {Object} instanceData - regras do chip (agent_name, company_name, calendly_link, product_type)
 */
async function enviarEmailRepasse(emailDestinatario, lead, instanceData) {
    if (!emailDestinatario) {
        return { success: false, messageId: null, error: 'Email do destinatário não informado' };
    }

    // 📭 Supressão (LGPD/bounce): respeita descadastro mesmo no fluxo de repasse.
    if (await db.isEmailSuprimido(emailDestinatario)) {
        console.log(`📭 [EMAIL] ${emailDestinatario} está na lista de supressão — repasse bloqueado.`);
        return { success: false, messageId: null, error: 'Email suprimido' };
    }

    const agente = instanceData.agent_name || 'Equipe Comercial';
    const companyName = instanceData.company_name || 'nossa empresa';
    const empresaOrigem = lead.name || 'uma empresa parceira';
    const calendlyLink = instanceData.calendly_link || '';
    const oferta = descricaoOferta(instanceData);
    const sobre = oferta ? ` sobre ${oferta}` : '';

    const assunto = `Indicação de ${empresaOrigem} — ${companyName}`;
    const corpo = `Olá,\n\nMeu nome é ${agente}, da ${companyName}. Fui indicado pelo pessoal da ${empresaOrigem} para falar com vocês${sobre}.\n\n${calendlyLink ? `Se quiser conversar, pode agendar um horário direto na minha agenda: ${calendlyLink}` : 'Fico à disposição para conversarmos.'}\n\nAtenciosamente,\n${agente} — ${companyName}`;

    try {
        const { data, error } = await getResend().emails.send(
            montarPayloadEmail(emailDestinatario, assunto, corpo, instanceData.email_from_address)
        );

        if (error) {
            console.error(`❌ [EMAIL] Falha ao enviar repasse para ${emailDestinatario}:`, error.message);
            return { success: false, messageId: null, error: error.message };
        }

        db.saveMessage(emailDestinatario, 'assistant', `[EMAIL REPASSE] ${assunto}\n\n${corpo}`, instanceData.id, instanceData.user_id, 'email').catch(() => {});

        console.log(`✅ [EMAIL] Repasse enviado para ${emailDestinatario} (origem: ${lead.name})`);
        return { success: true, messageId: data?.id || null, error: null };
    } catch (err) {
        console.error(`❌ [EMAIL] Erro inesperado no repasse para ${emailDestinatario}:`, err.message);
        return { success: false, messageId: null, error: err.message };
    }
}

module.exports = {
    enviarEmailOutbound,
    enviarEmailRepasse,
    gerarCopyOutbound, // usado pelo endpoint de preview (Ver exemplo) no painel
};
