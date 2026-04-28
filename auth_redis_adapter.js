const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

/**
 * Adaptador de Autenticação Enterprise para Baileys usando Redis.
 * Zera o IO de banco de dados relacional e resolve o gargalo de performance.
 */
async function useRedisAuthState(redisClient, sessionId) {
    const credsKey = `wpp_auth:${sessionId}:creds`;

    // Funções auxiliares para ler e escrever no Redis lidando com Buffers (criptografia)
    const readData = async (key) => {
        try {
            const data = await redisClient.get(key);
            return data ? JSON.parse(data, BufferJSON.reviver) : null;
        } catch (error) {
            console.error(`Erro ao ler chave ${key} do Redis:`, error);
            return null;
        }
    };

    const writeData = async (key, data) => {
        try {
            await redisClient.set(key, JSON.stringify(data, BufferJSON.replacer));
        } catch (error) {
            console.error(`Erro ao gravar chave ${key} no Redis:`, error);
        }
    };

    const removeData = async (key) => {
        try {
            await redisClient.del(key);
        } catch (error) {
            console.error(`Erro ao deletar chave ${key} no Redis:`, error);
        }
    };

    // 1. Carrega ou Inicializa as Credenciais (O "RG" do chip)
    let creds = await readData(credsKey);
    if (!creds) {
        creds = initAuthCreds();
        await writeData(credsKey, creds);
    }

    return {
        state: {
            creds,
            keys: {
                // 2. O WhatsApp pede chaves específicas para ler uma mensagem
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`wpp_auth:${sessionId}:${type}:${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                // 3. O WhatsApp atualiza chaves a cada "visto" ou nova mensagem
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `wpp_auth:${sessionId}:${category}:${id}`;
                            if (value) {
                                tasks.push(writeData(key, value));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => {
            return writeData(credsKey, creds);
        }
    };
}

module.exports = { useRedisAuthState };