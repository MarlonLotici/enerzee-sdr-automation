/**
 * DATABASE.JS - CAMADA DE DADOS SUPABASE (SaaS ANTIX V3)
 * Otimizado para Multi-Tenancy, White-label e Prompts Dinâmicos.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Inicialização com a Service Role Key para ignorar travas de RLS no backend
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
                name, 
                owner_phone,
                whatsapp_status,
                regional_rules,
                agent_name,
                company_name,
                system_prompt,
                daily_limit
            `)
            .eq('id', instanceId)
            .single();
            
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
        const hoje = new Date().toISOString().split('T')[0]; // Pega apenas a data YYYY-MM-DD
        
        const { count, error } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('instance_id', instanceId)
            .eq('status', 'contact') // Conta apenas quem já foi movido para atendimento
            .gte('last_contact_at', hoje); // Que ocorreu hoje

        if (error) {
            console.error(`[DB] Erro ao contar envios do chip ${instanceId}:`, error.message);
            return 999; // Trava por segurança se der erro na busca para não banir o chip
        }
        return count || 0;
    },

    // ========================================================================
    // 👥 GESTÃO DE LEADS (ANTI-DUPLICIDADE E PERSISTÊNCIA)
    // ========================================================================

    saveLead: async (lead, instanceId) => {
        // Normalização agressiva: Remove tudo que não é número e garante o sufixo Baileys
        const phonePuro = String(lead.phone || lead.whatsapp_id).replace(/\D/g, '');
        const zapId = phonePuro.includes('@') ? phonePuro : `${phonePuro}@s.whatsapp.net`;

        const leadData = {
            whatsapp_id: zapId,
            instance_id: instanceId,
            name: (lead.name || "Sem Nome").replace(/['"“”]/g, ""), // Limpa caracteres que quebram prompt
            phone: phonePuro,
            niche: lead.niche || "Empresa",
            cnpj: lead.cnpj || null,
            dono: lead.dono || null,
            endereco_fiscal: lead.endereco_fiscal || lead.address || null,
            bairro: lead.bairro || null,
            cep: lead.cep || null,
            porte: lead.porte || null,
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

    saveMessage: async (zapId, role, content, instanceId) => {
        const { error } = await supabase
            .from('messages')
            .insert([{ 
                whatsapp_id: zapId, 
                role: role, 
                content: content,
                instance_id: instanceId 
            }]);
        
        if (error) console.error(`[DB] Erro ao salvar msg de ${zapId}:`, error.message);
    },

    getHistory: async (zapId, instanceId) => {
        // Busca as 20 mensagens mais RECENTES (desc)
        const { data, error } = await supabase
            .from('messages')
            .select('role, content')
            .eq('whatsapp_id', zapId)
            .eq('instance_id', instanceId)
            .order('created_at', { ascending: false })
            .limit(20);
        
        if (error) return [];
        // Inverte o array para que a IA leia na ordem cronológica correta: [velha -> nova]
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