const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function useSupabaseAuthState(instanceId) {
    // 1. Tenta carregar as credenciais existentes do banco
    const { data: session } = await supabase
        .from('whatsapp_sessions')
        .select('data')
        .eq('id', instanceId)
        .maybeSingle();

    let creds;
    if (session) {
        creds = JSON.parse(session.data, BufferJSON.reviver);
    } else {
        creds = initAuthCreds();
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    // Nota: Para multi-instância em escala, Baileys prefere chaves em cache.
                    // Aqui você pode expandir para gerenciar keys separadas se necessário.
                    return {}; 
                },
                set: async (data) => {
                    // Baileys usa isso para atualizar keys (opcional para auth básica)
                }
            }
        },
        saveCreds: async () => {
            const dataString = JSON.stringify(creds, BufferJSON.replacer);
            await supabase.from('whatsapp_sessions').upsert({
                id: instanceId,
                data: dataString,
                updated_at: new Date().toISOString()
            });
        }
    };
}

module.exports = { useSupabaseAuthState };