const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 🛡️ Mutex por instância — garante que gravações no Supabase sejam sequenciais
// Evita que duas escritas simultâneas sobrescrevam uma chave recém-salva
const writeLocks = new Map();

async function acquireLock(instanceId) {
    while (writeLocks.get(instanceId)) {
        await new Promise(r => setTimeout(r, 10));
    }
    writeLocks.set(instanceId, true);
}

function releaseLock(instanceId) {
    writeLocks.delete(instanceId);
}

async function useSupabaseAuthState(instanceId) {
    // ── 1. CARREGAR CREDENCIAIS DO BANCO ──
    const { data: session } = await supabase
        .from('whatsapp_sessions')
        .select('data')
        .eq('id', instanceId)
        .maybeSingle();

    let creds;
    if (session?.data) {
        try {
            creds = JSON.parse(session.data, BufferJSON.reviver);
        } catch (e) {
            console.error(`❌ [AUTH] Credenciais corrompidas para ${instanceId}. Regenerando...`);
            creds = initAuthCreds();
        }
    } else {
        creds = initAuthCreds();
    }

    // ── 2. CARREGAR TODAS AS CHAVES DE SESSÃO JÁ SALVAS ──
    // Buscamos todas as chaves de uma vez e mantemos em memória pra acesso rápido
    const keysCache = new Map();

    const { data: savedKeys } = await supabase
        .from('whatsapp_keys')
        .select('key_type, key_id, key_data')
        .eq('instance_id', instanceId);

    if (savedKeys && savedKeys.length > 0) {
        for (const row of savedKeys) {
            try {
                const parsed = JSON.parse(row.key_data, BufferJSON.reviver);
                keysCache.set(`${row.key_type}:${row.key_id}`, parsed);
            } catch (e) {
                console.warn(`⚠️ [AUTH] Chave corrompida ignorada: ${row.key_type}:${row.key_id}`);
            }
        }
        console.log(`🔑 [AUTH] ${savedKeys.length} chaves de sessão carregadas para ${instanceId}`);
    }

    return {
        state: {
            creds,
            keys: {
                // ── LEITURA DE CHAVES ──
                get: async (type, ids) => {
                    const result = {};
                    for (const id of ids) {
                        const cacheKey = `${type}:${id}`;
                        const value = keysCache.get(cacheKey);
                        if (value) {
                            // Algumas chaves (como app-state-sync-key) precisam ser reconstruídas como proto
                            if (type === 'app-state-sync-key' && value) {
                                result[id] = proto.Message.AppStateSyncKeyData.fromObject(value);
                            } else {
                                result[id] = value;
                            }
                        }
                    }
                    return result;
                },

                // ── ESCRITA DE CHAVES (COM FILA SEQUENCIAL) ──
                set: async (data) => {
                    await acquireLock(instanceId);

                    try {
                        const upserts = [];
                        const deletes = [];

                        for (const category in data) {
                            for (const id in data[category]) {
                                const value = data[category][id];
                                const cacheKey = `${category}:${id}`;

                                if (value) {
                                    // Atualiza cache em memória imediatamente
                                    keysCache.set(cacheKey, value);

                                    // Prepara para salvar no banco
                                    upserts.push({
                                        instance_id: instanceId,
                                        key_type: category,
                                        key_id: id,
                                        key_data: JSON.stringify(value, BufferJSON.replacer),
                                        updated_at: new Date().toISOString()
                                    });
                                } else {
                                    // value === null significa deletar
                                    keysCache.delete(cacheKey);
                                    deletes.push({ category, id });
                                }
                            }
                        }

                        // Executa upserts em lote (mais rápido que um por um)
                        if (upserts.length > 0) {
                            const { error } = await supabase
                                .from('whatsapp_keys')
                                .upsert(upserts, { onConflict: 'instance_id,key_type,key_id' });

                            if (error) {
                                console.error(`❌ [AUTH] Falha ao salvar chaves:`, error.message);
                            }
                        }

                        // Executa deletes
                        for (const del of deletes) {
                            await supabase
                                .from('whatsapp_keys')
                                .delete()
                                .eq('instance_id', instanceId)
                                .eq('key_type', del.category)
                                .eq('key_id', del.id);
                        }
                    } catch (e) {
                        console.error(`❌ [AUTH] Erro crítico no set de chaves:`, e.message);
                    } finally {
                        releaseLock(instanceId);
                    }
                }
            }
        },

        // ── GRAVAÇÃO DE CREDENCIAIS (COM MUTEX) ──
        saveCreds: async () => {
            await acquireLock(instanceId);

            try {
                const dataString = JSON.stringify(creds, BufferJSON.replacer);
                const { error } = await supabase.from('whatsapp_sessions').upsert({
                    id: instanceId,
                    data: dataString,
                    updated_at: new Date().toISOString()
                });

                if (error) {
                    console.error(`❌ [AUTH] Falha ao salvar credenciais:`, error.message);
                }
            } catch (e) {
                console.error(`❌ [AUTH] Erro crítico em saveCreds:`, e.message);
            } finally {
                releaseLock(instanceId);
            }
        }
    };
}

module.exports = { useSupabaseAuthState };