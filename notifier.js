const axios = require('axios');

async function enviarAlerta(titulo, mensagem, cor = 3447003) {
    if (!process.env.DISCORD_WEBHOOK_URL) return;

    try {
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
            embeds: [{
                title: titulo,
                description: mensagem,
                color: cor,
                timestamp: new Date()
            }]
        });
    } catch (err) {
        console.error("Erro ao enviar para o Discord:", err.message);
    }
}

module.exports = { enviarAlerta };