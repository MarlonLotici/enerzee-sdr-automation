'use strict';
// ============================================================================
// 📣 CAMPANHAS DE REAQUECIMENTO — regras PURAS (sem banco/rede, testáveis).
// O motor (lib/campanhaMotor.js) e as rotas usam estas funções. Nenhuma regra de
// NICHO aqui: só mecânica de envio (telefone, variáveis, janela, elegibilidade,
// status). O que a IA fala vem do prompt do tenant + prompt da campanha.
// ============================================================================

const STATUS_TERMINAIS = new Set(['respondeu', 'convertido', 'optout', 'falhou', 'ignorado']);
// Ordem de progresso: um webhook atrasado nunca "rebaixa" (ex.: delivered chegando depois do read).
const RANK_STATUS = { pendente: 0, enviado: 1, entregue: 2, lido: 3, respondeu: 4, convertido: 5 };
const STATUS_META = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' };
const STATUS_LEAD_INVALIDO = new Set(['invalid', 'invalid_number']);

// ── Telefone ────────────────────────────────────────────────────────────────
// Aceita "(11) 99999-8888", "+55 11 99999-8888", "5511999998888"... → "5511999998888".
// Sem DDI (10/11 dígitos) assume Brasil. Retorna null se não parecer telefone válido.
function normalizarTelefone(raw) {
    let d = String(raw ?? '').replace(/\D/g, '');
    if (!d) return null;
    d = d.replace(/^0+/, '');                          // 0xx (DDD com zero) / 00 (internacional)
    if (d.length === 10 || d.length === 11) d = '55' + d;
    if (d.startsWith('55') && (d.length < 12 || d.length > 13)) return null;
    if (d.length < 10 || d.length > 15) return null;
    return d;
}
const jidDeTelefone = (digitos) => `${digitos}@s.whatsapp.net`;

// Celular BR pode chegar da Meta SEM o 9º dígito (wa_id de contas antigas) ou com ele.
// Devolve as 2 formas pra achar o lead importado quando ele responde.
function variantesJidBR(jid) {
    const d = String(jid || '').replace(/@.*/, '').replace(/\D/g, '');
    const out = new Set([`${d}@s.whatsapp.net`]);
    if (d.startsWith('55') && d.length === 13 && d[4] === '9') out.add(`${d.slice(0, 4)}${d.slice(5)}@s.whatsapp.net`);
    if (d.startsWith('55') && d.length === 12 && /[6-9]/.test(d[4])) out.add(`${d.slice(0, 4)}9${d.slice(4)}@s.whatsapp.net`);
    return [...out];
}

// ── Variáveis do template ───────────────────────────────────────────────────
function _primeiroNome(nome) {
    const p = String(nome || '').trim().split(/\s+/)[0] || '';
    if (!p || /\d/.test(p)) return '';
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

// Lê um campo do lead pra preencher {{n}}. Campos: nome, primeiro_nome, empresa, email,
// telefone, ou "dados.<coluna>" (colunas livres importadas do CSV).
function valorDoCampo(lead, campo) {
    const c = String(campo || '').trim();
    if (!c) return '';
    if (c.startsWith('dados.')) {
        const v = lead?.dados_cliente?.[c.slice(6)];
        return v === undefined || v === null ? '' : String(v).trim();
    }
    switch (c) {
        case 'primeiro_nome': return _primeiroNome(lead?.dono || lead?.name);
        case 'nome':          return String(lead?.dono || lead?.name || '').trim();
        case 'empresa':       return String(lead?.dados_cliente?.empresa || lead?.name || '').trim();
        case 'email':         return String(lead?.email || '').trim();
        case 'telefone':      return String(lead?.phone || '').trim();
        default:              return '';
    }
}

// variaveis: [{ campo, padrao }] na ordem de {{1}}, {{2}}... A Meta REJEITA parâmetro vazio,
// então campo sem valor usa o `padrao` (ex.: "tudo bem") — e sem padrão o envio é barrado.
function montarParametros(variaveis, lead) {
    const valores = [];
    for (const [i, v] of (variaveis || []).entries()) {
        const valor = valorDoCampo(lead, v?.campo) || String(v?.padrao || '').trim();
        if (!valor) return { ok: false, erro: `variável {{${i + 1}}} vazia para este contato (campo "${v?.campo}") e sem valor padrão` };
        valores.push(valor.slice(0, 1000));
    }
    const componentes = valores.length
        ? [{ type: 'body', parameters: valores.map(text => ({ type: 'text', text })) }]
        : [];
    return { ok: true, valores, componentes };
}

// Texto que o lead viu (pra salvar no histórico: a IA e o painel precisam saber o que foi dito).
function renderizarTexto(texto, valores) {
    return String(texto || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => valores[Number(n) - 1] ?? m);
}

// ── Janela de horário (BRT) ─────────────────────────────────────────────────
function horaBRT(agora = new Date()) {
    return new Date(agora.getTime() - 3 * 3600 * 1000).getUTCHours();
}
function dentroDaJanela(agora, inicio, fim) {
    const h = horaBRT(agora);
    return h >= Number(inicio) && h < Number(fim);
}
// Início do dia BRT em ISO (pra contar envios "de hoje" contra o limite diário).
function inicioDoDiaBRT(agora = new Date()) {
    const brt = new Date(agora.getTime() - 3 * 3600 * 1000);
    brt.setUTCHours(0, 0, 0, 0);
    return new Date(brt.getTime() + 3 * 3600 * 1000).toISOString();
}

// ── Elegibilidade de um envio ───────────────────────────────────────────────
// Retorna { acao: 'enviar' } | { acao: 'adiar', ate, motivo } | { acao: 'ignorar', motivo }.
function avaliarEnvio({ contato, lead, campanha, agora = new Date(), ultimaMsgDoLeadAt = null }) {
    if (!lead) return { acao: 'ignorar', motivo: 'lead_removido' };
    if (lead.opt_out) return { acao: 'ignorar', motivo: 'opt_out' };
    if (lead.do_not_call) return { acao: 'ignorar', motivo: 'do_not_call' };
    if (STATUS_LEAD_INVALIDO.has(lead.status)) return { acao: 'ignorar', motivo: 'numero_invalido' };
    if (STATUS_TERMINAIS.has(contato?.status)) return { acao: 'ignorar', motivo: `status_${contato.status}` };

    const passos = Array.isArray(campanha?.templates) ? campanha.templates : [];
    if ((contato?.passo ?? 0) >= passos.length) return { acao: 'ignorar', motivo: 'sem_proximo_passo' };

    // Conversa em andamento (lead falou nas últimas 24h): não interrompe com template — adia 1 dia.
    if (ultimaMsgDoLeadAt && agora - new Date(ultimaMsgDoLeadAt) < 24 * 3600 * 1000) {
        return { acao: 'adiar', ate: new Date(agora.getTime() + 24 * 3600 * 1000).toISOString(), motivo: 'conversa_ativa' };
    }

    // Frequência: só no 1º toque, e só se a última campanha recebida foi OUTRA.
    const freqDias = Number(campanha?.frequencia_dias) || 0;
    if ((contato?.passo ?? 0) === 0 && freqDias > 0 && lead.ultima_campanha_at
        && lead.ultima_campanha_id && lead.ultima_campanha_id !== campanha.id
        && agora - new Date(lead.ultima_campanha_at) < freqDias * 24 * 3600 * 1000) {
        return { acao: 'ignorar', motivo: 'frequencia' };
    }
    return { acao: 'enviar' };
}

// Próximo envio depois de mandar o passo `passoEnviado` (0-based). null = acabou a cadência.
function proximoEnvioApos(passoEnviado, templates, agora = new Date()) {
    const prox = (templates || [])[passoEnviado + 1];
    if (!prox) return null;
    const dias = Math.max(1, Number(prox.esperaDias) || 2);
    return new Date(agora.getTime() + dias * 24 * 3600 * 1000).toISOString();
}

// ── Opt-out ─────────────────────────────────────────────────────────────────
// Só pedidos INEQUÍVOCOS (palavra única tipo "PARAR", botão do template, ou frase explícita).
// "vou parar pra almoçar" NÃO é opt-out.
const _OPTOUT_EXATO = /^(parar|pare|sair|stop|cancelar|descadastrar|remover|nao quero|n quero)[.!\s]*$/;
const _OPTOUT_FRASE = /\b(nao (quero|desejo) (mais )?(receber|mensage|ser contatad|contato)|para de me (mandar|enviar|chamar)|pare de me (mandar|enviar|chamar)|me (tira|remove|exclui) (da|dessa|desta) lista|nao me (mande|envie|chame) mais|descadastr)/;
function ehOptOut(texto) {
    const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/^\(audio\)\s*/, '').trim();
    if (!t) return false;
    return _OPTOUT_EXATO.test(t) || _OPTOUT_FRASE.test(t);
}

// ── Webhook de status da Meta ───────────────────────────────────────────────
// value.statuses[] → [{ wamid, status, erro, em }]
function extrairStatuses(webhookBody) {
    const out = [];
    for (const entry of webhookBody?.entry || []) {
        for (const ch of entry?.changes || []) {
            for (const s of ch?.value?.statuses || []) {
                const status = STATUS_META[s?.status];
                if (!s?.id || !status) continue;
                const e = s.errors?.[0];
                out.push({
                    wamid: s.id,
                    status,
                    erro: e ? `${e.code || ''} ${e.title || e.message || ''}`.trim() : null,
                    em: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString(),
                });
            }
        }
    }
    return out;
}

// Webhook de qualidade do número (field "phone_number_quality_update"): DOWNGRADE/FLAGGED = perigo.
function extrairAlertaQualidade(webhookBody) {
    for (const entry of webhookBody?.entry || []) {
        for (const ch of entry?.changes || []) {
            if (ch?.field !== 'phone_number_quality_update') continue;
            const ev = String(ch?.value?.event || '').toUpperCase();
            if (ev === 'DOWNGRADE' || ev === 'FLAGGED') {
                return { evento: ev, limite: ch?.value?.current_limit || null };
            }
        }
    }
    return null;
}

// Aplica um status vindo da Meta numa linha de campanha_contatos → patch (ou null se não muda).
function patchDeStatus(contato, novo, custoCents = 0) {
    if (!contato || STATUS_TERMINAIS.has(contato.status) && novo.status !== 'falhou') return null;
    if (novo.status === 'falhou') {
        if (['respondeu', 'convertido', 'optout'].includes(contato.status)) return null;
        return { status: 'falhou', erro: novo.erro || 'falha na entrega', proximo_envio_at: null };
    }
    if ((RANK_STATUS[novo.status] ?? -1) <= (RANK_STATUS[contato.status] ?? -1)) return null;
    const patch = { status: novo.status };
    if (novo.status === 'entregue') {
        patch.entregue_at = novo.em;
        patch.custo_cents = (contato.custo_cents || 0) + custoCents; // Meta cobra template ENTREGUE
    }
    if (novo.status === 'lido') {
        patch.lido_at = novo.em;
        if (!contato.entregue_at) {
            patch.entregue_at = novo.em;
            patch.custo_cents = (contato.custo_cents || 0) + custoCents;
        }
    }
    return patch;
}

// ── Métricas / saúde da campanha ────────────────────────────────────────────
function resumirFunil(contatos) {
    const r = { total: 0, pendentes: 0, enviados: 0, entregues: 0, lidos: 0, responderam: 0, convertidos: 0, optout: 0, falhas: 0, ignorados: 0, custo_cents: 0 };
    for (const c of contatos || []) {
        r.total++;
        r.custo_cents += c.custo_cents || 0;
        const s = c.status;
        if (s === 'pendente') { r.pendentes++; continue; }
        if (s === 'ignorado') { r.ignorados++; continue; }
        if (s === 'falhou') { r.falhas++; continue; }
        if (s === 'optout') { r.optout++; }
        // funil acumulado: quem respondeu também foi enviado/entregue/lido
        r.enviados++;
        if (c.entregue_at || ['entregue', 'lido', 'respondeu', 'convertido'].includes(s)) r.entregues++;
        if (c.lido_at || ['lido', 'respondeu', 'convertido'].includes(s)) r.lidos++;
        if (c.respondeu_at || ['respondeu', 'convertido'].includes(s)) r.responderam++;
        if (s === 'convertido') r.convertidos++;
    }
    return r;
}

// Trava de segurança: muita falha ou muito opt-out = a campanha está queimando o número.
function motivoAutoPausa(funil, { minAmostra = 50, maxFalha = 0.2, maxOptout = 0.05 } = {}) {
    const tentados = funil.enviados + funil.falhas;
    if (tentados < minAmostra) return null;
    if (funil.falhas / tentados > maxFalha) return `taxa de falha ${(100 * funil.falhas / tentados).toFixed(0)}% (> ${maxFalha * 100}%)`;
    if (funil.enviados > 0 && funil.optout / funil.enviados > maxOptout) return `taxa de opt-out ${(100 * funil.optout / funil.enviados).toFixed(1)}% (> ${maxOptout * 100}%)`;
    return null;
}

// Seleção de público: { lotes: ['jan-2026'], campo: 'dados.produto', operador: 'igual'|'contem', valor }
function leadCasaFiltro(lead, filtro = {}) {
    const lotes = Array.isArray(filtro.lotes) ? filtro.lotes.filter(Boolean) : [];
    if (lotes.length && !lotes.includes(lead.base_lote)) return false;
    if (filtro.campo && filtro.valor !== undefined && String(filtro.valor).trim() !== '') {
        const v = valorDoCampo(lead, filtro.campo).toLowerCase();
        const alvo = String(filtro.valor).trim().toLowerCase();
        if (filtro.operador === 'contem' ? !v.includes(alvo) : v !== alvo) return false;
    }
    return true;
}

// ── Importação de base ──────────────────────────────────────────────────────
// linhas: [{ telefone, nome, email, empresa, ...colunasLivres }] (o navegador já mapeou as colunas).
// → { validos: [{ whatsapp_id, phone, nome, email, dados }], invalidos: [linhaN], duplicados }
const _CAMPOS_FIXOS = new Set(['telefone', 'nome', 'email']);
function prepararImportacao(linhas) {
    const validos = [];
    const invalidos = [];
    const vistos = new Set();
    let duplicados = 0;
    (Array.isArray(linhas) ? linhas : []).forEach((l, i) => {
        const tel = normalizarTelefone(l?.telefone);
        if (!tel) { invalidos.push(i + 1); return; }
        const whatsapp_id = jidDeTelefone(tel);
        if (vistos.has(whatsapp_id)) { duplicados++; return; }
        vistos.add(whatsapp_id);
        const dados = {};
        for (const [k, v] of Object.entries(l || {})) {
            if (_CAMPOS_FIXOS.has(k)) continue;
            const chave = String(k).trim().slice(0, 60);
            const valor = v === null || v === undefined ? '' : String(v).trim().slice(0, 500);
            if (chave && valor) dados[chave] = valor;
        }
        validos.push({
            whatsapp_id, phone: tel,
            nome: String(l?.nome || '').trim().slice(0, 120) || null,
            email: String(l?.email || '').trim().toLowerCase().slice(0, 160) || null,
            dados,
        });
    });
    return { validos, invalidos, duplicados };
}

// Validação de payload de criação de campanha (rota). Retorna string de erro ou null.
function validarCampanha(c) {
    if (!c || typeof c !== 'object') return 'payload inválido';
    if (!String(c.nome || '').trim()) return 'nome obrigatório';
    if (!c.instance_id) return 'instance_id obrigatório';
    if (!['reativacao', 'upsell', 'outro'].includes(c.objetivo || 'reativacao')) return 'objetivo inválido';
    const t = c.templates;
    if (!Array.isArray(t) || t.length < 1 || t.length > 3) return 'informe de 1 a 3 templates (passos da cadência)';
    for (const [i, p] of t.entries()) {
        if (!String(p?.nome || '').trim()) return `passo ${i + 1}: template sem nome`;
        if (!Array.isArray(p.variaveis || [])) return `passo ${i + 1}: variaveis deve ser lista`;
    }
    const ini = Number(c.janela_inicio ?? 9), fim = Number(c.janela_fim ?? 19);
    if (!(ini >= 0 && ini < fim && fim <= 24)) return 'janela de horário inválida';
    const lim = Number(c.limite_diario ?? 100);
    if (!(lim >= 1 && lim <= 100000)) return 'limite diário inválido';
    if (String(c.prompt_campanha || '').length > 4000) return 'prompt da campanha: máximo 4000 caracteres';
    return null;
}

module.exports = {
    STATUS_TERMINAIS, RANK_STATUS,
    normalizarTelefone, jidDeTelefone, variantesJidBR,
    valorDoCampo, montarParametros, renderizarTexto,
    horaBRT, dentroDaJanela, inicioDoDiaBRT,
    avaliarEnvio, proximoEnvioApos, ehOptOut,
    extrairStatuses, extrairAlertaQualidade, patchDeStatus,
    resumirFunil, motivoAutoPausa, leadCasaFiltro, validarCampanha, prepararImportacao,
};
