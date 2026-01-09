// Arquivo: server.js (NA RAIZ DO PROJETO)
const express = require('express');
const cors = require('cors');
const { iniciarVarredura } = require('./1_scraper'); // Note o 1_ na frente

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Rota para o Front-end acionar
app.get('/api/buscar', async (req, res) => {
    const { cidade, nicho } = req.query;

    if (!cidade || !nicho) {
        return res.status(400).json({ sucesso: false, mensagem: "Cidade e Nicho são obrigatórios." });
    }

    try {
        console.log(`[MOTOR] Comando recebido: ${nicho} em ${cidade}`);
        // Inicia a lógica inteligente que discutimos
        const resultados = await iniciarVarredura(cidade, [nicho]);

        res.json({
            sucesso: true,
            quantidade: resultados.length,
            dados: resultados
        });
    } catch (error) {
        console.error("[ERRO NO SERVIDOR]", error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🔥 SISTEMA EZEE CONNECT ONLINE`);
    console.log(`📡 Aguardando comandos na porta ${PORT}`);
});