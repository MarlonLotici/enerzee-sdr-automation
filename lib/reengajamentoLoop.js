'use strict';
/**
 * Varredor do REENGAJAMENTO (ver lib/reengajamento.js). Roda a cada poucos minutos: acha os leads que
 * escreveram, receberam resposta da IA e sumiram; decide (lembrete 45 min / despedida ~22 h); envia.
 *
 * Dependências INJETADAS (supabase, redis, enviar) → dá pra rodar em "simulação" contra o banco real sem
 * mandar nada e sem Redis. Nunca lança: erro de banco/Redis = ciclo pulado (o próximo tenta de novo).
 */
const { decidirReengajamento, montarTexto, indiceUltimoInbound } = require('./reengajamento');

const TTL_FLAG_S = 3 * 24 * 3600; // a marca "já enviei" vale 3 dias (bem acima da janela de 24h)
const chaveFlag = (tipo, leadId, inboundEm) => `reengaj:${tipo}:${leadId}:${inboundEm}`;

async function lerFlags(redis, leadId, inboundEm) {
    const [l, d] = await Promise.all([
        redis.exists(chaveFlag('lembrete', leadId, inboundEm)),
        redis.exists(chaveFlag('despedida', leadId, inboundEm)),
    ]);
    return { lembrete: !!l, despedida: !!d };
}

/**
 * @param {object} p
 * @param {object} p.supabase
 * @param {object} p.redis                 ioredis-like: exists / set(k,v,'EX',s,'NX') / del
 * @param {Function} p.enviar              async ({ instancia, lead, tipo, texto }) → envia e grava a msg. Lança se falhar.
 * @param {Function} [p.nomeDe]            (lead) → primeiro nome ('' se não houver)
 * @param {RegExp}  [p.optOutRegex]
 * @param {boolean} [p.simular]            true = só decide e loga, não reserva flag nem envia
 * @param {Array}   [p.instancias]         sobrescreve a busca de instâncias (testes/simulação)
 * @param {object}  [p.config]             sobrescreve horários/tempos
 * @param {number}  [p.maxEnvios]          teto de envios por varredura (evita rajada)
 * @param {number}  [p.pausaEntreEnviosMs] pausa entre envios (parece humano; 0 nos testes)
 * @returns {Promise<{instancias:number, candidatos:number, enviados:Array, ignorados:object, erro?:string}>}
 */
async function varrerReengajamentos({
    supabase, redis, enviar, nomeDe = () => '', optOutRegex = null, simular = false, instancias = null,
    config = {}, agora = Date.now(), maxEnvios = 8, pausaEntreEnviosMs = 4000, log = console,
}) {
    const resumo = { instancias: 0, candidatos: 0, enviados: [], ignorados: {} };
    const ignorar = (motivo) => { resumo.ignorados[motivo] = (resumo.ignorados[motivo] || 0) + 1; };

    try {
        let insts = instancias;
        if (!insts) {
            const { data, error } = await supabase.from('instances')
                .select('id, user_id, name, dry_run, reengajamento_ativo, reengaj_msg_lembrete, reengaj_msg_despedida')
                .eq('whatsapp_provider', 'official').eq('reengajamento_ativo', true);
            if (error) { resumo.erro = error.message; return resumo; } // coluna ainda não existe (SQL não rodado) → desligado
            insts = data || [];
        }
        resumo.instancias = insts.length;

        const desde = new Date(agora - 26 * 3600e3).toISOString();
        const ate = new Date(agora - 40 * 60e3).toISOString();

        for (const inst of insts) {
            // candidatos: leads "em conversa" cuja última fala DA IA foi há 40 min…26 h (filtro barato; a decisão fina é abaixo)
            const { data: leads, error: errLeads } = await supabase.from('leads')
                .select('id, name, dono, whatsapp_id, status, is_paused, manual_pause, last_contact_at, instance_id, user_id')
                .eq('instance_id', inst.id).eq('status', 'contact').eq('is_paused', false)
                .gte('last_contact_at', desde).lte('last_contact_at', ate)
                .order('last_contact_at', { ascending: true }).limit(40);
            if (errLeads) { resumo.erro = errLeads.message; continue; }

            for (const lead of leads || []) {
                resumo.candidatos++;
                if (resumo.enviados.length >= maxEnvios) { ignorar('limite_do_ciclo'); continue; }

                let q = supabase.from('messages').select('role, content, created_at')
                    .eq('whatsapp_id', lead.whatsapp_id).order('created_at', { ascending: false }).limit(14);
                if (lead.user_id) q = q.eq('user_id', lead.user_id);
                const { data: mensagens, error: errMsg } = await q;
                if (errMsg || !mensagens) { ignorar('erro_ao_ler_conversa'); continue; }

                // marcas do período de silêncio atual (chave = instante da última msg do lead)
                const iIn = indiceUltimoInbound(mensagens);
                const inboundEm = iIn >= 0 ? Date.parse(mensagens[iIn].created_at) : null;
                const flags = inboundEm ? await lerFlags(redis, lead.id, inboundEm) : {};

                const d = decidirReengajamento({
                    lead, instancia: { reengajamento_ativo: true }, mensagens, flags, agora, optOutRegex, config,
                });
                if (d.acao === 'nenhuma') { ignorar(d.motivo); continue; }

                const tipo = d.acao; // 'lembrete' | 'despedida'
                const texto = montarTexto(tipo, {
                    nome: nomeDe(lead), agora,
                    override: tipo === 'lembrete' ? inst.reengaj_msg_lembrete : inst.reengaj_msg_despedida,
                });

                if (simular || inst.dry_run) {
                    log.log?.(`🧪 [REENGAJ-SIMULA] ${tipo} → ${lead.name} (${String(lead.whatsapp_id).split('@')[0]}): "${texto}"`);
                    resumo.enviados.push({ lead: lead.name, tipo, texto, simulado: true });
                    continue;
                }

                // reserva ANTES de enviar (se duas varreduras se cruzarem, só uma envia; se o Redis cair, NÃO envia)
                const chave = chaveFlag(tipo, lead.id, d.inboundEm);
                let reservou = null;
                try { reservou = await redis.set(chave, '1', 'EX', TTL_FLAG_S, 'NX'); } catch (_) { reservou = null; }
                if (reservou !== 'OK') { ignorar('ja_enviado_ou_redis_fora'); continue; }

                try {
                    await enviar({ instancia: inst, lead, tipo, texto });
                    resumo.enviados.push({ lead: lead.name, tipo, texto });
                    log.log?.(`🔔 [REENGAJ] ${tipo} enviado → ${lead.name}.`);
                    if (pausaEntreEnviosMs > 0) await new Promise(r => setTimeout(r, pausaEntreEnviosMs + Math.random() * 3000));
                } catch (e) {
                    try { await redis.del(chave); } catch (_) { /* tenta de novo no próximo ciclo */ }
                    ignorar('falha_no_envio');
                    log.warn?.(`⚠️ [REENGAJ] Falha ao enviar ${tipo} para ${lead.name}: ${e.message}`);
                }
            }
        }
    } catch (e) {
        resumo.erro = e.message;
    }
    return resumo;
}

module.exports = { varrerReengajamentos, chaveFlag };
