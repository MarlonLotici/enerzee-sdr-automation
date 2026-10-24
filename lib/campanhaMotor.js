'use strict';
// ============================================================================
// 📣 MOTOR DE CAMPANHAS DE REAQUECIMENTO (WhatsApp API oficial)
//
// Estado 100% no banco (campanhas / campanha_contatos): a cada tick pega os contatos com
// proximo_envio_at vencido, REIVINDICA cada um com update condicional (nunca envia o mesmo
// passo 2x, mesmo com ticks concorrentes ou restart), checa elegibilidade e envia o
// TEMPLATE aprovado. Webhook de status atualiza entregue/lido/falhou pelo wamid; resposta
// do lead para a cadência e a conversa segue na esteira normal da IA.
//
// Fábrica com dependências injetadas → testável sem Supabase/Meta (ver test/campanhaMotor.test.js).
// ============================================================================

const R = require('./campanhas');

const LOTE_POR_TICK = Number(process.env.CAMPANHA_LOTE_TICK) || 30;
const PAUSA_ENTRE_ENVIOS_MS = Number(process.env.CAMPANHA_PAUSA_MS) || 1200;
const CUSTO_TEMPLATE_CENTS = Number(process.env.CUSTO_TEMPLATE_MARKETING_CENTS) || 35; // ~US$0,06 → R$0,35 (ajuste)
const BUDGET_TEMPLATE_DIA = Number(process.env.BUDGET_TEMPLATE_DIA) || 2000;          // por conta/dia
const CHECAGEM_SAUDE_MS = 10 * 60 * 1000;
const ERRO_TRANSITORIO = /\b(130429|131056|131000|500|502|503|504)\b|fetch failed|ECONN|ETIMEDOUT|rate limit/i;

function criarMotorCampanhas(deps) {
    const {
        supabase, getRegras, transport, salvarMensagem,
        alerta = async () => {}, budget = null,
        agora = () => new Date(), dormir = (ms) => new Promise(r => setTimeout(r, ms)),
        log = console,
    } = deps;

    let rodando = false;
    let timer = null;
    let tabelasAusentes = false;
    const ultimaChecagemSaude = new Map(); // campanhaId → ms

    const _cfg = (regras) => ({ apiKey: regras.cloud_api_key, baseUrl: regras.cloud_base_url });

    async function _contar(campanhaId, filtro) {
        let q = supabase.from('campanha_contatos').select('id', { count: 'exact', head: true }).eq('campanha_id', campanhaId);
        q = filtro(q);
        const { count, error } = await q;
        if (error) throw new Error(error.message);
        return count || 0;
    }

    // Lê todas as linhas paginando de 1000 em 1000 (limite padrão do PostgREST).
    async function _todas(montar, max = 100000) {
        const out = [];
        for (let de = 0; de < max; de += 1000) {
            const { data, error } = await montar().range(de, de + 999);
            if (error) throw new Error(error.message);
            out.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        return out;
    }

    async function pausar(campanhaId, motivo) {
        await supabase.from('campanhas').update({ status: 'pausada', motivo_pausa: motivo }).eq('id', campanhaId);
    }

    // ── Ciclo ───────────────────────────────────────────────────────────────
    async function tick() {
        if (rodando || tabelasAusentes) return;
        rodando = true;
        try {
            const { data: ativas, error } = await supabase.from('campanhas').select('*').eq('status', 'ativa');
            if (error) {
                if (/campanhas/.test(error.message) && /(not find|does not exist)/i.test(error.message)) {
                    tabelasAusentes = true;
                    log.warn('⚠️ [CAMPANHA] Tabelas de campanha não existem (rode db/campanhas.sql). Motor desligado.');
                    return;
                }
                throw new Error(error.message);
            }
            for (const c of ativas || []) {
                try { await processarCampanha(c); }
                catch (e) { log.error(`❌ [CAMPANHA ${String(c.id).slice(0, 8)}] ${e.message}`); }
            }
        } catch (e) {
            log.error('❌ [CAMPANHA] Falha no tick:', e.message);
        } finally {
            rodando = false;
        }
    }

    async function _checarSaude(c) {
        const ult = ultimaChecagemSaude.get(c.id) || 0;
        if (agora().getTime() - ult < CHECAGEM_SAUDE_MS) return false;
        ultimaChecagemSaude.set(c.id, agora().getTime());
        const falhas = await _contar(c.id, q => q.eq('status', 'falhou'));
        const optout = await _contar(c.id, q => q.eq('status', 'optout'));
        const enviados = await _contar(c.id, q => q.not('ultimo_envio_at', 'is', null).neq('status', 'falhou'));
        const motivo = R.motivoAutoPausa({ enviados, falhas, optout });
        if (!motivo) return false;
        await pausar(c.id, `Auto-pausa: ${motivo}`);
        log.warn(`⏸️ [CAMPANHA ${String(c.id).slice(0, 8)}] Auto-pausa: ${motivo}`);
        alerta(`⏸️ Campanha pausada automaticamente: ${c.nome}`, `${motivo}. Revise o template/base antes de retomar.`).catch(() => {});
        return true;
    }

    async function processarCampanha(c) {
        const regras = await getRegras(c.instance_id);
        if (!regras || regras.whatsapp_provider !== 'official') {
            await pausar(c.id, 'O chip da campanha não está na API oficial da Meta.');
            return;
        }
        if (await _checarSaude(c)) return;
        if (!R.dentroDaJanela(agora(), c.janela_inicio, c.janela_fim)) return;

        const enviadosHoje = await _contar(c.id, q => q.gte('ultimo_envio_at', R.inicioDoDiaBRT(agora())));
        const restante = (Number(c.limite_diario) || 0) - enviadosHoje;
        if (restante <= 0) return;

        const { data: fila, error } = await supabase.from('campanha_contatos')
            .select('*').eq('campanha_id', c.id)
            .not('proximo_envio_at', 'is', null).lte('proximo_envio_at', agora().toISOString())
            .order('proximo_envio_at', { ascending: true })
            .limit(Math.min(restante, LOTE_POR_TICK));
        if (error) throw new Error(error.message);

        if (!fila || fila.length === 0) {
            const agendados = await _contar(c.id, q => q.not('proximo_envio_at', 'is', null));
            if (agendados === 0) {
                await supabase.from('campanhas').update({ status: 'concluida', concluida_em: agora().toISOString() }).eq('id', c.id);
                log.log(`🏁 [CAMPANHA ${String(c.id).slice(0, 8)}] Concluída — cadência terminou para todos os contatos.`);
            }
            return;
        }

        for (const contato of fila) {
            if (budget && !(await budget.podeGastar(c.user_id, 'template', BUDGET_TEMPLATE_DIA))) {
                log.warn(`💸 [CAMPANHA] Teto diário de templates atingido para a conta ${String(c.user_id).slice(0, 8)}.`);
                return;
            }
            const enviou = await processarContato(c, regras, contato);
            if (enviou) await dormir(PAUSA_ENTRE_ENVIOS_MS);
        }
    }

    // Reivindica o contato (update condicional) e decide: enviar / adiar / ignorar.
    async function processarContato(c, regras, contato) {
        const { data: claim, error: errClaim } = await supabase.from('campanha_contatos')
            .update({ proximo_envio_at: null })
            .eq('id', contato.id).eq('proximo_envio_at', contato.proximo_envio_at)
            .select('id');
        if (errClaim || !claim || claim.length === 0) return false; // outro tick pegou

        const { data: lead } = await supabase.from('leads')
            .select('id, name, dono, email, phone, whatsapp_id, instance_id, status, opt_out, do_not_call, dados_cliente, base_lote, ultima_campanha_at, ultima_campanha_id')
            .eq('id', contato.lead_id).maybeSingle();

        let ultimaMsgDoLeadAt = null;
        if (lead) {
            const { data: ult } = await supabase.from('messages').select('created_at')
                .eq('whatsapp_id', lead.whatsapp_id).eq('instance_id', c.instance_id).eq('role', 'user')
                .order('created_at', { ascending: false }).limit(1);
            ultimaMsgDoLeadAt = ult?.[0]?.created_at || null;
        }

        const decisao = R.avaliarEnvio({ contato, lead, campanha: c, agora: agora(), ultimaMsgDoLeadAt });
        if (decisao.acao === 'ignorar') {
            await supabase.from('campanha_contatos').update({ status: 'ignorado', erro: decisao.motivo }).eq('id', contato.id);
            return false;
        }
        if (decisao.acao === 'adiar') {
            await supabase.from('campanha_contatos').update({ proximo_envio_at: decisao.ate }).eq('id', contato.id);
            return false;
        }

        const passo = contato.passo || 0;
        const tpl = c.templates[passo];
        const params = R.montarParametros(tpl.variaveis, lead);
        if (!params.ok) {
            await supabase.from('campanha_contatos').update({ status: 'falhou', erro: params.erro }).eq('id', contato.id);
            return false;
        }

        try {
            const r = await transport.enviarTemplate(_cfg(regras), lead.whatsapp_id, tpl.nome, tpl.idioma || 'pt_BR', params.componentes);
            const quando = agora().toISOString();
            await supabase.from('campanha_contatos').update({
                status: 'enviado', wamid: r?.id || null, erro: null,
                passo: passo + 1, ultimo_envio_at: quando,
                entregue_at: null, lido_at: null,
                proximo_envio_at: R.proximoEnvioApos(passo, c.templates, agora()),
            }).eq('id', contato.id);
            await supabase.from('leads').update({ ultima_campanha_at: quando, ultima_campanha_id: c.id, last_contact_at: quando }).eq('id', lead.id);
            // A IA e o painel precisam ver o que o lead recebeu (template não passa pelo histórico sozinho).
            const texto = R.renderizarTexto(tpl.texto, params.valores) || `(template ${tpl.nome})`;
            await salvarMensagem(lead.whatsapp_id, 'assistant', texto, c.instance_id);
            if (budget) await budget.registrarGasto(c.user_id, 'template', BUDGET_TEMPLATE_DIA);
            log.log(`📣 [CAMPANHA ${String(c.id).slice(0, 8)}] Passo ${passo + 1} enviado para ${lead.whatsapp_id.split('@')[0]} (wamid ${r?.id || 'n/a'}).`);
            return true;
        } catch (e) {
            const transitorio = ERRO_TRANSITORIO.test(e.message);
            await supabase.from('campanha_contatos').update(transitorio
                ? { proximo_envio_at: new Date(agora().getTime() + 30 * 60 * 1000).toISOString(), erro: e.message.slice(0, 300) }
                : { status: 'falhou', erro: e.message.slice(0, 300) }
            ).eq('id', contato.id);
            log.warn(`⚠️ [CAMPANHA ${String(c.id).slice(0, 8)}] Envio ${transitorio ? 'adiado' : 'falhou'}: ${e.message}`);
            return false;
        }
    }

    // ── Ações (rotas) ──────────────────────────────────────────────────────
    // Monta o público (leads do tenant no chip da campanha que casam com o filtro) e ativa.
    async function iniciarCampanha(campanhaId, userId) {
        const { data: c, error } = await supabase.from('campanhas').select('*').eq('id', campanhaId).eq('user_id', userId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!c) throw new Error('Campanha não encontrada.');
        if (c.status === 'ativa') return { ok: true, adicionados: 0, jaAtiva: true };
        const regras = await getRegras(c.instance_id);
        if (!regras || regras.whatsapp_provider !== 'official') throw new Error('Campanhas só rodam em chip da API oficial da Meta.');

        let adicionados = 0;
        if (!c.iniciada_em) {
            const leads = await _todas(() => supabase.from('leads')
                .select('id, name, dono, email, phone, status, opt_out, do_not_call, dados_cliente, base_lote')
                .eq('user_id', userId).eq('instance_id', c.instance_id).order('id'));
            const publico = leads.filter(l => !l.opt_out && !l.do_not_call
                && !['invalid', 'invalid_number'].includes(l.status) && R.leadCasaFiltro(l, c.filtro_segmento));
            const quando = agora().toISOString();
            for (let i = 0; i < publico.length; i += 500) {
                const linhas = publico.slice(i, i + 500).map(l => ({
                    campanha_id: c.id, lead_id: l.id, user_id: userId, passo: 0, status: 'pendente', proximo_envio_at: quando,
                }));
                const { error: errIns } = await supabase.from('campanha_contatos')
                    .upsert(linhas, { onConflict: 'campanha_id,lead_id', ignoreDuplicates: true });
                if (errIns) throw new Error(errIns.message);
                adicionados += linhas.length;
            }
            if (adicionados === 0) throw new Error('Nenhum contato da base casa com o público desta campanha.');
        }
        await supabase.from('campanhas').update({
            status: 'ativa', motivo_pausa: null, iniciada_em: c.iniciada_em || agora().toISOString(),
        }).eq('id', c.id);
        ultimaChecagemSaude.delete(c.id);
        return { ok: true, adicionados };
    }

    async function pausarPeloUsuario(campanhaId, userId) {
        const { data, error } = await supabase.from('campanhas')
            .update({ status: 'pausada', motivo_pausa: 'Pausada pelo usuário' })
            .eq('id', campanhaId).eq('user_id', userId).in('status', ['ativa']).select('id');
        if (error) throw new Error(error.message);
        return { ok: true, pausada: (data || []).length > 0 };
    }

    async function pausarCampanhasDaInstancia(instanceId, motivo) {
        const { data } = await supabase.from('campanhas').update({ status: 'pausada', motivo_pausa: motivo })
            .eq('instance_id', instanceId).eq('status', 'ativa').select('id, nome');
        return data || [];
    }

    // ── Eventos do webhook ─────────────────────────────────────────────────
    async function registrarStatuses(statuses) {
        let atualizados = 0;
        for (const s of statuses || []) {
            const { data: contato } = await supabase.from('campanha_contatos')
                .select('id, status, custo_cents, entregue_at').eq('wamid', s.wamid).maybeSingle();
            if (!contato) continue; // status de mensagem que não é de campanha
            const patch = R.patchDeStatus(contato, s, CUSTO_TEMPLATE_CENTS);
            if (!patch) continue;
            await supabase.from('campanha_contatos').update(patch).eq('id', contato.id);
            atualizados++;
        }
        return atualizados;
    }

    // Contatos "vivos" (não terminais) do lead em qualquer campanha.
    async function _contatosAbertos(leadId) {
        const { data } = await supabase.from('campanha_contatos')
            .select('id, campanha_id, status').eq('lead_id', leadId)
            .not('status', 'in', '(respondeu,convertido,optout,falhou,ignorado)');
        return data || [];
    }

    async function registrarResposta(leadId) {
        const abertos = await _contatosAbertos(leadId);
        const pendenteOuEnviado = abertos.filter(c => c.status !== 'pendente'); // só conta resposta a algo enviado
        if (!pendenteOuEnviado.length) return 0;
        const quando = agora().toISOString();
        for (const c of pendenteOuEnviado) {
            await supabase.from('campanha_contatos').update({ status: 'respondeu', respondeu_at: quando, proximo_envio_at: null }).eq('id', c.id);
        }
        return pendenteOuEnviado.length;
    }

    async function registrarOptOut(leadId) {
        const quando = agora().toISOString();
        await supabase.from('leads').update({ opt_out: true, opt_out_at: quando, is_paused: true }).eq('id', leadId);
        await supabase.from('campanha_contatos').update({ status: 'optout', proximo_envio_at: null })
            .eq('lead_id', leadId).not('status', 'in', '(convertido,optout)');
    }

    async function marcarConvertido(leadId, campanhaId = null) {
        let q = supabase.from('campanha_contatos').select('id, campanha_id, status')
            .eq('lead_id', leadId).in('status', ['enviado', 'entregue', 'lido', 'respondeu']);
        if (campanhaId) q = q.eq('campanha_id', campanhaId);
        const { data } = await q.order('ultimo_envio_at', { ascending: false }).limit(1);
        const alvo = data?.[0];
        if (!alvo) return false;
        await supabase.from('campanha_contatos').update({ status: 'convertido', convertido_at: agora().toISOString(), proximo_envio_at: null }).eq('id', alvo.id);
        return true;
    }

    // Contexto (DADOS) da campanha mais recente do lead nos últimos 30 dias, pro resolvedor de prompt.
    async function contextoDoLead(leadId) {
        if (tabelasAusentes || !leadId) return null;
        const desde = new Date(agora().getTime() - 30 * 24 * 3600 * 1000).toISOString();
        const { data } = await supabase.from('campanha_contatos')
            .select('campanha_id, status, ultimo_envio_at').eq('lead_id', leadId)
            .not('ultimo_envio_at', 'is', null).gte('ultimo_envio_at', desde)
            .order('ultimo_envio_at', { ascending: false }).limit(1);
        const cc = data?.[0];
        if (!cc) return null;
        const { data: camp } = await supabase.from('campanhas').select('nome, objetivo, prompt_campanha').eq('id', cc.campanha_id).maybeSingle();
        return camp ? { ...camp, campanha_id: cc.campanha_id, status_contato: cc.status } : null;
    }

    // ── Métricas ───────────────────────────────────────────────────────────
    async function metricas(campanhaId) {
        const linhas = await _todas(() => supabase.from('campanha_contatos')
            .select('status, entregue_at, lido_at, respondeu_at, custo_cents').eq('campanha_id', campanhaId).order('id'));
        return R.resumirFunil(linhas);
    }

    function iniciar(intervaloMs = Number(process.env.CAMPANHA_TICK_MS) || 60000) {
        if (timer) return;
        timer = setInterval(() => { tick().catch(() => {}); }, intervaloMs);
        log.log(`📣 [CAMPANHA] Motor de campanhas ligado (tick ${Math.round(intervaloMs / 1000)}s).`);
    }
    function parar() { clearInterval(timer); timer = null; }

    return {
        tick, iniciar, parar, processarCampanha, processarContato,
        iniciarCampanha, pausarPeloUsuario, pausarCampanhasDaInstancia,
        registrarStatuses, registrarResposta, registrarOptOut, marcarConvertido,
        contextoDoLead, metricas,
    };
}

module.exports = { criarMotorCampanhas, CUSTO_TEMPLATE_CENTS };
