const Groq = require('groq-sdk');

const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODELO = 'llama-3.1-8b-instant';

/**
 * Gera inteligência de vendas solar para um nicho comercial desconhecido.
 * Retorna { equipamentos, dor_principal, angulo_venda } ou lança erro.
 */
async function gerarInteligenciaNicho(nicheName) {
    const prompt = `Você é um especialista em vendas de energia solar fotovoltaica para empresas brasileiras.
Recebi o nome de um nicho comercial e preciso que você gere dados de inteligência de vendas.

NICHO: "${nicheName}"

Retorne SOMENTE um JSON válido com exatamente estas 3 chaves. Sem markdown, sem texto extra.

- "equipamentos": string curta listando os principais equipamentos elétricos típicos deste nicho que consomem muita energia (ex: "compressores, elevadores, ar condicionado industrial").
- "dor_principal": string de 1 frase descrevendo a maior dor energética deste nicho (ex: "alto custo com ar condicionado ligado o dia todo").
- "angulo_venda": string de 1 frase com o melhor argumento de abertura para vender solar para este nicho (ex: "seu compressor e as câmaras frias consomem energia 24h — a solar elimina até 95% disso").

Exemplo de retorno válido:
{"equipamentos":"freezers, câmaras frias, iluminação LED","dor_principal":"freezer rodando 24h eleva muito a conta de luz","angulo_venda":"com solar você zera o custo do freezer que nunca desliga"}`;

    const res = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model:       MODELO,
        temperature: 0.1,
        max_tokens:  120,
    });

    const raw = res.choices[0]?.message?.content?.trim() || '{}';

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`nicheAgent: JSON inválido para nicho "${nicheName}": ${raw}`);
    }

    const { equipamentos, dor_principal, angulo_venda } = parsed;
    if (!equipamentos || !dor_principal || !angulo_venda) {
        throw new Error(`nicheAgent: campos incompletos para nicho "${nicheName}": ${raw}`);
    }

    return { equipamentos, dor_principal, angulo_venda };
}

module.exports = { gerarInteligenciaNicho };
