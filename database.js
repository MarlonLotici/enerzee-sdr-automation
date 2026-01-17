const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const db = {
    // Salvar ou atualizar lead
    saveLead: async (lead) => {
        const { data, error } = await supabase
            .from('leads')
            .upsert({
                whatsapp_id: lead.whatsappId || lead.phone,
                name: lead.name,
                phone: lead.phone,
                niche: lead.niche,
                cnpj: lead.cnpj,
                dono: lead.dono,
                endereco_fiscal: lead.endereco_fiscal,
                bairro: lead.bairro,
                cep: lead.cep,
                porte: lead.porte,
                capital_social: lead.capital_social,
                status: lead.status || 'new',
                quality_score: lead.quality_score
            }, { onConflict: 'whatsapp_id' });
        return { data, error };
    },

    // Salvar mensagem no histórico
    saveMessage: async (zapId, role, content) => {
        await supabase.from('messages').insert([{ whatsapp_id: zapId, role, content }]);
    },

    // Verificar se número está na blacklist
    isBlacklisted: async (zapId) => {
        const { data } = await supabase.from('blacklist').select('*').eq('whatsapp_id', zapId);
        return data.length > 0;
    }
};

module.exports = db;