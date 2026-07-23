/**
 * DATABASE.JS - CAMADA DE DADOS SUPABASE (SaaS ANTIX V3)
 * Otimizado para Multi-Tenancy, White-label e Prompts Dinâmicos.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Inicialização com a Service Role Key para ignorar travas de RLS no backend
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Cache instanceId → user_id para evitar lookup repetido por mensagem
const _instanciaUserIdCache = new Map();

async function _resolverUserId(instanceId) {
    if (!instanceId) return null;
    if (_instanciaUserIdCache.has(instanceId)) return _instanciaUserIdCache.get(instanceId);
    const { data } = await supabase
        .from('instances')
        .select('user_id')
        .eq('id', instanceId)
        .maybeSingle();
    const uid = data?.user_id || null;
    _instanciaUserIdCache.set(instanceId, uid);
    return uid;
}

const db = {
    // ========================================================================
    // 🏢 GESTÃO DE INSTÂNCIAS (CHIPS/CLIENTES DO SAAS)
    // ========================================================================

    getActiveInstances: async () => {
        const { data, error } = await supabase
            .from('instances')
            .select('*')
            // Pega quem está conectado/desconectado, ignora banidos ou null
            .neq('whatsapp_status', 'BANNED') 
            .order('created_at', { ascending: true });
        
        if (error) console.error('[DB] Erro ao buscar instâncias:', error.message);
        return data || [];
    },

    // 🚀 A GRANDE MUDANÇA ANTIX: Puxando o "Cérebro" do cliente do banco
    getInstanceRules: async (instanceId) => {
        const { data, error } = await supabase
            .from('instances')
            .select(`
                id,
                user_id,
                name,
                owner_phone,
                whatsapp_status,
                regional_rules,
                agent_name,
                company_name,
                system_prompt,
                daily_limit,
                calendly_link,
                opening_templates,
                product_type,
                email_prompt,
                firing_paused,
                use_email_outbound,
                use_sms_outbound,
                inbound_only,
                whatsapp_provider,
                cloud_api_key,
                cloud_base_url,
                dry_run,
                created_at
            `)
            .eq('id', instanceId)
            .maybeSingle();

        if (error) {
            console.error(`[DB] Erro ao puxar regras da instância ${instanceId}:`, error.message);
            return null;
        }
        return data;
    },

    updateInstanceStatus: async (instanceId, status) => {
        await supabase
            .from('instances')
            .update({ whatsapp_status: status, updated_at: new Date() })
            .eq('id', instanceId);
    },

    getDailyContactCount: async (instanceId) => {
        const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('T')[0]; // Data em BRT (UTC-3)

        // Conta todos os leads contatados hoje, independente do status atual.
        // O filtro antigo usava status='contact', mas leads que avançaram para booked/dead/invalid
        // no mesmo dia saíam da contagem, fazendo o motor disparar além do limite configurado.
        // followup_count=0 garante que só contamos aberturas, não follow-ups.
        const { count, error } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('instance_id', instanceId)
            .eq('followup_count', 0)
            .neq('status', 'new')
            .gte('last_contact_at', hoje);

        if (error) {
            console.error(`[DB] Erro ao contar envios do chip ${instanceId}:`, error.message);
            return 0;
        }
        return count || 0;
    },

    // ========================================================================
    // 👥 GESTÃO DE LEADS (ANTI-DUPLICIDADE E PERSISTÊNCIA)
    // ========================================================================

    saveLead: async (lead, instanceId, userId) => {
        // Normalização agressiva: Remove tudo que não é número e garante o sufixo Baileys
        const phonePuro = String(lead.phone || lead.whatsapp_id).replace(/\D/g, '');
        const zapId = phonePuro.includes('@') ? phonePuro : `${phonePuro}@s.whatsapp.net`;


                // Proteção multi-tenant: impede sobrescrever lead de outro cliente
        const { data: leadExistente } = await supabase
            .from('leads').select('user_id').eq('whatsapp_id', zapId).maybeSingle();
        if (leadExistente && leadExistente.user_id && leadExistente.user_id !== userId) {
            console.log(`🛡️ [MULTI-TENANT] Lead ${zapId} pertence a outro tenant. Upsert bloqueado.`);
            return { error: null };
        }

        let estadoFinal = lead.estado;

// 🕵️ Se o estado estiver vazio, descobre pelo DDD
if (!estadoFinal && phonePuro) {
    const ddd = phonePuro.substring(2, 4);
    const mapaDDD = {
        '47':'SC','48':'SC','49':'SC','41':'PR','42':'PR','43':'PR','44':'PR','45':'PR','46':'PR',
        '11':'SP','12':'SP','13':'SP','14':'SP','15':'SP','16':'SP','17':'SP','18':'SP','19':'SP',
        '31':'MG','32':'MG','33':'MG','34':'MG','35':'MG','37':'MG','38':'MG','21':'RJ','22':'RJ','24':'RJ',
        '71':'BA','73':'BA','74':'BA','75':'BA','77':'BA','62':'GO','64':'GO'
    };
    estadoFinal = mapaDDD[ddd] || null;
}

        const leadData = {
            user_id: userId, // 🔐 AQUI: Vincula o lead ao usuário logado
            whatsapp_id: zapId,
            instance_id: instanceId,
            name: (lead.name || "Sem Nome").replace(/['"“”]/g, ""), // Limpa caracteres que quebram prompt
            phone: phonePuro,
            niche: lead.niche || "Empresa",
            cnpj: lead.cnpj || null,
            dono: lead.dono || null,
            endereco_fiscal: lead.endereco_fiscal || lead.address || null,
            bairro: lead.bairro || null,
            estado: estadoFinal,
            cep: lead.cep || null,
            porte: lead.porte || null,
            email: lead.email || null,
            capital_social_numeric: lead.capital_social_numeric || 0,
            lat: lead.lat || null,
            lng: lead.lng || null,
            status: lead.status || 'new',
            updated_at: new Date()
        };

        // Tenta o salvamento. Se houver conflito no whatsapp_id, ele apenas ATUALIZA (upsert)
        let { error } = await supabase
            .from('leads')
            .upsert(leadData, { onConflict: 'whatsapp_id' });

        if (error) {
            console.error(`❌ [DB ERROR]: ${error.message}`);
            // Fallback: Marca como erro no banco para revisão manual no Dashboard
            await supabase.from('leads').upsert({
                user_id: userId, // 🔐 AQUI: Também vincula no fallback
                whatsapp_id: zapId,
                name: lead.name,
                instance_id: instanceId,
                status: 'error',
                updated_at: new Date()
            }, { onConflict: 'whatsapp_id' });
        } else {
            console.log(`✅ [DB] Lead persistido com sucesso: ${lead.name}`);
            return { error: null };
        }
    },

    updateLeadStatus: async (whatsappId, updates) => {
        const { error } = await supabase
            .from('leads')
            .update({ ...updates, updated_at: new Date() })
            .eq('whatsapp_id', whatsappId);
        return error;
    },

    // ========================================================================
    // 💬 GESTÃO DE MENSAGENS (MEMÓRIA NEURAL)
    // ========================================================================

    // channel: 'whatsapp' (default) | 'email' | 'sms'. Unifica o histórico do lead
    // independente do canal — base para inbox unificado futuro.
    // Resiliência: o campo `channel` só é incluído no insert quando NÃO é 'whatsapp'.
    // Assim o fluxo vivo de WhatsApp continua funcionando mesmo antes da coluna `channel`
    // existir no banco — só o canal email (novo, ainda não em produção) depende dela.
    saveMessage: async (zapId, role, content, instanceId, userId = null, channel = 'whatsapp') => {
        // Resolve user_id via cache lazy — necessário para o RLS do frontend enxergar as mensagens
        const resolvedUserId = userId || await _resolverUserId(instanceId);

        const row = {
            whatsapp_id: zapId,
            role: role,
            content: content,
            instance_id: instanceId,
            user_id: resolvedUserId
        };
        if (channel && channel !== 'whatsapp') row.channel = channel;

        const { error } = await supabase.from('messages').insert([row]);

        if (error) console.error(`[DB] Erro ao salvar msg de ${zapId} [uid:${resolvedUserId}]:`, error.message);
    },

    getHistory: async (zapId, instanceId) => {
        // Filtra apenas por zapId — não por instanceId — para que o histórico
        // seja preservado quando o lead muda de chip (redistribuição).
        const { data, error } = await supabase
            .from('messages')
            .select('role, content')
            .eq('whatsapp_id', zapId)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) return [];
        return data.reverse();
    },

    isBlacklisted: async (zapId) => {
        const { data } = await supabase
            .from('blacklist')
            .select('id')
            .eq('whatsapp_id', zapId)
            .limit(1);
        return data && data.length > 0;
    },

    // Primeiro caminho de ESCRITA real na tabela blacklist do projeto — usado pela
    // detecção de opt-out (LGPD): quando o lead pede "PARE"/"SAIR", entra aqui.
    // Idempotente: se o número já está na blacklist, não duplica.
    adicionarBlacklist: async (zapId, motivo = 'opt-out do lead') => {
        if (!zapId) return;
        const jaExiste = await db.isBlacklisted(zapId);
        if (jaExiste) return;
        const { error } = await supabase
            .from('blacklist')
            .insert([{ whatsapp_id: zapId, motivo }]);
        if (error) console.error(`[DB] Erro ao adicionar ${zapId} à blacklist:`, error.message);
        else console.log(`🚫 [BLACKLIST] ${zapId} adicionado — motivo: ${motivo}`);
    },

    // Supressão de EMAIL (LGPD/deliverability): checada antes de todo envio outbound.
    // Alimentada pelo webhook /webhook/resend (bounce/complaint/unsubscribe) e por
    // cliques no link de descadastro.
    isEmailSuprimido: async (email) => {
        if (!email) return false;
        const { data } = await supabase
            .from('email_suppression')
            .select('id')
            .eq('email', String(email).toLowerCase().trim())
            .limit(1);
        return data && data.length > 0;
    },

    adicionarEmailSupressao: async (email, motivo = 'unsubscribe') => {
        if (!email) return;
        const emailNorm = String(email).toLowerCase().trim();
        const jaExiste = await db.isEmailSuprimido(emailNorm);
        if (jaExiste) return;
        const { error } = await supabase
            .from('email_suppression')
            .insert([{ email: emailNorm, motivo }]);
        if (error) console.error(`[DB] Erro ao suprimir email ${emailNorm}:`, error.message);
        else console.log(`📭 [EMAIL-SUPRESSÃO] ${emailNorm} suprimido — motivo: ${motivo}`);
    },

    // ========================================================================
    // 🧠 INTELIGÊNCIA DE NICHO (DYNAMIC RAG)
    // ========================================================================

    obterTodosNichos: async () => {
        const { data, error } = await supabase
            .from('niche_intelligence')
            .select('niche_name, equipamentos, dor_principal, angulo_venda');

        if (error) {
            console.error('[DB] obterTodosNichos — erro ao carregar cache:', error.message);
            return [];
        }
        return data || [];
    },

    salvarInteligenciaNicho: async ({ niche_name, equipamentos, dor_principal, angulo_venda }) => {
        if (!niche_name?.trim()) {
            throw new Error('salvarInteligenciaNicho: niche_name é obrigatório.');
        }

        // Normaliza a PK: minúsculas + remove acentos + trim
        const slug = niche_name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .trim();

        const { data, error } = await supabase
            .from('niche_intelligence')
            .upsert(
                { niche_name: slug, equipamentos, dor_principal, angulo_venda, updated_at: new Date().toISOString() },
                { onConflict: 'niche_name' }
            )
            .select()
            .single();

        if (error) {
            console.error(`[DB] salvarInteligenciaNicho — erro ao salvar nicho "${slug}":`, error.message);
            throw new Error(`Falha ao salvar nicho: ${error.message}`);
        }

        console.log(`✅ [DB] Inteligência de nicho salva: "${slug}"`);
        return data;
    },

    // ========================================================================
    // 🔄 REPASSE — ATUALIZA LEAD EXISTENTE PARA O DECISOR
    // ========================================================================

    atualizarLeadParaDecisor: async ({ leadId, novoNomeDecisor, novoPhone, labelNumeroAntigo = 'recepcao' }) => {
        // 1. Busca o lead atual para capturar phone e backup_phones existentes
        const { data: leadAtual, error: erroBusca } = await supabase
            .from('leads')
            .select('id, phone, backup_phones')
            .eq('id', leadId)
            .single();

        if (erroBusca || !leadAtual) {
            const msg = erroBusca?.message || 'Lead não encontrado';
            console.error(`[DB] atualizarLeadParaDecisor — erro ao buscar lead ${leadId}: ${msg}`);
            throw new Error(`Lead não encontrado: ${msg}`);
        }

        // 2. Normaliza o novo número: só dígitos + garante DDI 55 + gera JID Baileys
        const digitosNovos = String(novoPhone).replace(/\D/g, '');
        if (digitosNovos.length < 10) {
            throw new Error(`Número inválido para decisor: "${novoPhone}"`);
        }
        const phoneNormalizado = digitosNovos.startsWith('55') ? digitosNovos : `55${digitosNovos}`;
        const novoJID = `${phoneNormalizado}@s.whatsapp.net`;

        // 3. Constrói o novo histórico de backups
        const backupsAtuais = Array.isArray(leadAtual.backup_phones) ? leadAtual.backup_phones : [];
        const novoBackup = {
            phone:    leadAtual.phone,
            label:    labelNumeroAntigo,
            moved_at: new Date().toISOString(),
        };
        const backupsAtualizados = [...backupsAtuais, novoBackup];

        // 4. UPDATE atômico — reinicia o lead para o motor SDR como contato novo
        const { data: leadAtualizado, error: erroUpdate } = await supabase
            .from('leads')
            .update({
                phone:          phoneNormalizado,
                whatsapp_id:    novoJID,
                dono:           novoNomeDecisor || leadAtual.dono,
                backup_phones:  backupsAtualizados,
                status:         'new',
                is_paused:      false,
                followup_count: 0,
                updated_at:     new Date().toISOString(),
            })
            .eq('id', leadId)
            .select()
            .single();

        if (erroUpdate) {
            console.error(`[DB] atualizarLeadParaDecisor — erro ao atualizar lead ${leadId}:`, erroUpdate.message);
            throw new Error(`Falha ao atualizar lead: ${erroUpdate.message}`);
        }

        console.log(`✅ [DB] Lead ${leadId} atualizado para decisor "${novoNomeDecisor}" → ${novoJID}`);
        return leadAtualizado;
    },

    removeInstance: async (instanceId) => {
        // Primeiro desvincula os leads deste chip (seta instance_id para null)
        await supabase
            .from('leads')
            .update({ instance_id: null })
            .eq('instance_id', instanceId);

        // Agora deleta o chip sem violar a foreign key
        const { error } = await supabase
            .from('instances')
            .delete()
            .eq('id', instanceId);

        if (error) console.error('[DB] Erro ao remover instância:', error.message);
        return { error };
    }
};

module.exports = db;