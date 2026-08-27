const { chamarLLM, MODELOS } = require('../lib/llm');

// Parse tolerante: o LLM às vezes envolve o JSON em cerca markdown (```json) ou põe
// texto em volta. Extrai o bloco { ... } (do primeiro { ao último }) e tenta parsear.
// Retorna o objeto ou null (nunca lança).
function _parseJsonRobusto(txt) {
    if (!txt || typeof txt !== 'string') return null;
    const limpo = txt.replace(/```json/gi, '').replace(/```/g, '').trim();
    const ini = limpo.indexOf('{');
    const fim = limpo.lastIndexOf('}');
    const candidato = (ini !== -1 && fim > ini) ? limpo.slice(ini, fim + 1) : limpo;
    try { return JSON.parse(candidato); } catch { /* tenta o texto cru abaixo */ }
    try { return JSON.parse(limpo); } catch { return null; }
}

/**
 * Audita uma conversa encerrada e retorna um relatório estruturado.
 * Atua como gerente de vendas sênior: avalia tom, oportunidades perdidas e desfecho.
 *
 * @returns {{ desfecho, nota_ia, erro_critico_ia, resumo_executivo }} | null
 */
async function gerarAuditoria(historico, lead, productType = 'solar') {
    if (!historico || historico.length < 2) return null;

    const isSolar = !productType || productType === 'solar';

    const transcricao = historico
        .map(m => `[${m.role === 'assistant' ? 'IA' : 'LEAD'}]: ${m.content}`)
        .join('\n');

    const descPerdidoSolar = isSolar
        ? 'PERDIDO_SOLAR: lead já possui energia solar instalada'
        : 'PERDIDO_SOLAR: lead já possui solução equivalente ao produto ofertado';
    const descPerdidoCaro = isSolar
        ? 'PERDIDO_CARO: lead reclamou de preço ou conta de energia abaixo de R$300'
        : 'PERDIDO_CARO: lead reclamou de preço ou orçamento acima do disponível';

    const prompt = `Você é um gerente de vendas sênior avaliando uma conversa do SDR de IA da Antix Flow.
Leia a conversa abaixo e retorne SOMENTE um JSON válido, sem markdown, sem texto extra.

NICHO DA EMPRESA: ${lead.niche || 'não informado'}

CONVERSA:
${transcricao}

CAMPOS DO JSON:
- "desfecho": exatamente uma das opções: "AGENDADO" | "PERDIDO_SOLAR" | "PERDIDO_CARO" | "PERDIDO_SILENCIO" | "PERDIDO_ROBO" | "PERDIDO_OUTRO"
  * AGENDADO: lead agendou ou confirmou reunião
  * ${descPerdidoSolar}
  * ${descPerdidoCaro}
  * PERDIDO_SILENCIO: lead parou de responder
  * PERDIDO_ROBO: era URA, autoresposta ou robô
  * PERDIDO_OUTRO: qualquer outro motivo

- "nota_ia": número inteiro de 0 a 10 avaliando a performance da IA:
  * 9-10: execução perfeita, soou humana, seguiu o funil
  * 7-8: bom mas com pequenos desvios
  * 5-6: oportunidades perdidas, tom inadequado
  * 0-4: erros graves (repetição, alucinação, queimou o lead)

- "erro_critico_ia": string de 1 frase descrevendo o pior erro cometido pela IA.
  Se não houve erro relevante, retorne null.

- "resumo_executivo": string de 1 frase resumindo o resultado da conversa para o gestor.

Exemplo de saída válida:
{"desfecho":"PERDIDO_CARO","nota_ia":7,"erro_critico_ia":"A IA perguntou o valor da conta antes de qualificar o equipamento.","resumo_executivo":"Lead descartado por conta abaixo do mínimo após qualificação incompleta."}`;

    try {
        // Modelo CÉREBRO: julgar uma conversa + emitir JSON estrito é tarefa de raciocínio.
        // O rápido (DeepSeek-Flash) volta vazio/inválido demais pra isso (visto nos logs do roteador).
        const raw = (await chamarLLM({ messages: [{ role: 'user', content: prompt }], model: MODELOS.cerebro, maxTokens: 500 }) || '').trim();
        const parsed = _parseJsonRobusto(raw);
        if (!parsed) throw new Error('LLM não devolveu JSON parseável.');

        // Valida estrutura mínima antes de retornar
        if (!parsed.desfecho || parsed.nota_ia === undefined) {
            throw new Error('Campos obrigatórios ausentes no JSON retornado.');
        }

        return {
            desfecho:          parsed.desfecho,
            nota_ia:           Number(parsed.nota_ia),
            erro_critico_ia:   parsed.erro_critico_ia || null,
            resumo_executivo:  parsed.resumo_executivo || '',
        };
    } catch (err) {
        console.error(`❌ [AUDITOR] Falha ao auditar ${lead.name}:`, err.message);
        return null;
    }
}

module.exports = { gerarAuditoria };
