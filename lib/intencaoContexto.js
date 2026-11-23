'use strict';
/**
 * Conferência de contexto da intenção que o roteador (LLM) devolveu. Função PURA.
 *
 * Bug 2026-11-23 (teste da Sofia): o roteador lia a fala do cliente SEM a pergunta que a IA tinha feito e errava:
 *   "tenho uma funcionária"  → REPASSE  (achou que o cliente passou um contato)
 *   "a secretária responde"  → REPASSE
 *   "as pessoas esperam..."  → OBJEÇÃO  (era a DOR, descrita pelo cliente)
 *   "não" (resposta a "a pessoa espera muito?") → OBJEÇÃO
 * REPASSE e OBJEÇÃO desviam a conversa do ciclo de venda (o fluxo de objeção tenta "quebrar" algo que não existe e o
 * de repasse grava "aguardando telefone do decisor" nas notas, que depois vira instrução crítica pro prompt).
 *
 * Regra: o LLM só pode classificar como REPASSE/OBJEÇÃO se a fala tiver um SINAL explícito disso (ou se a pergunta da IA
 * pedia exatamente isso). Sem sinal → é conversa normal (DUVIDA/CONTINUAR).
 */

// Recusa/objeção de verdade. De propósito NÃO inclui "não" solto, "não posso", "só tenho 1": isso é o cliente descrevendo o negócio.
const RE_OBJECAO_EXPLICITA = new RegExp([
    '\\b(?:caro|car[ií]ssimo|muito\\s+alto|pre[çc]o\\s+(?:alto|salgado))\\b',
    '\\bsem\\s+(?:interesse|verba|dinheiro|or[çc]amento|condi[çc][õo]es)\\b',
    '\\bn[aã]o\\s+(?:quero|preciso|tenho\\s+(?:interesse|tempo|verba|dinheiro|or[çc]amento)|faz\\s+sentido|me\\s+interessa|vou|confio|acredito|vejo\\s+valor|posso\\s+pagar|[ée]\\s+(?:o\\s+)?momento|[ée]\\s+pra\\s+mim)\\b',
    '\\bagora\\s+n[aã]o\\b',
    '\\bj[aá]\\s+(?:tenho|uso|usamos|temos|trabalho\\s+com)\\s+(?:um|uma|o|a)?\\s*(?:sistema|ferramenta|rob[oô]|solu[çc][aã]o|ia|chatbot|empresa|fornecedor|ag[eê]ncia|parceiro|plataforma)\\b',
    '\\b(?:vou\\s+pensar|deixa\\s+pra\\s+depois|depois\\s+eu\\s+(?:vejo|falo|te\\s+chamo)|mais\\s+pra\\s+frente|outra\\s+hora)\\b',
    '\\b(?:golpe|spam|propaganda|pare\\s+de|para\\s+de|me\\s+tira|sair\\s+da\\s+lista)\\b',
].join('|'), 'i');

// A pergunta da IA era uma proposta/convite? Aí um "não" seco é recusa.
const RE_IA_CONVIDOU = /(faz\s+sentido|vale\s+a\s+pena|que\s+tal|topa|podemos|poder[íi]amos|bora|quer\s+ver)\b[^?]*\b(reuni[aã]o|call|conversa|bate[-\s]?papo|papo|demonstra\w*|apresenta\w*|teste|15\s*min|30\s*min|agendar|marcar)/i;

const RE_NAO_SECO = /^\s*(?:n[aã]o|nao|nop|nope|negativo)[\s.!]*$/i;

// O cliente PASSOU um contato / indicou outra pessoa (REPASSE de verdade).
const RE_REPASSE_EXPLICITO = new RegExp([
    '\\b(?:fal[ae]r?|convers[ae]r?|lig[ae]r?|cham[ae]r?|procur[ae]r?|mand[ae]r?|envi[ae]r?|encaminh[ae]r?)\\s+(?:com|pr[ao]|para)\\s+(?:o|a|meu|minha|seu|sua)?\\s*\\w+',
    '\\b(?:meu|minha)\\s+(?:s[oó]cio|s[oó]cia|chefe|marido|esposa|gerente|diretor|diretora|dono|dona|pai|m[aã]e|contador|contadora)\\b',
    '\\b(?:o|a)\\s+(?:respons[aá]vel|decisor|dono|dona|gerente|diretor|diretora)\\b',
    '\\bpass(?:a|ar|o|e)\\s+(?:o\\s+)?(?:contato|n[uú]mero|telefone|whats\\w*|e-?mail)',
    '\\bquem\\s+(?:decide|resolve|cuida|compra)\\b',
].join('|'), 'i');

// A pergunta da IA pedia justamente o decisor/contato? ("quem cuida disso?", "com quem eu falo?")
const RE_IA_PERGUNTOU_DECISOR = /(quem\s+(?:[ée]|decide|cuida|resolve|responde)\s+(?:por|pelo|pela|d[ao]|essa|esse|isso)|respons[aá]vel|decisor|com\s+quem\s+(?:eu\s+)?(?:falo|posso\s+falar)|falar\s+com\s+(?:o|a)\s+(?:dono|s[oó]cio|respons))/i;

/**
 * @param {string} intencao  o que o roteador devolveu (COMPRA, OBJECAO, REPASSE, DUVIDA...)
 * @param {string} texto     fala do cliente
 * @param {{ultimaIA?: string}} ctx  última fala da IA antes dessa mensagem do cliente
 * @returns {string} a intenção, rebaixada pra 'DUVIDA' (conversa normal) quando não há sinal explícito
 */
function ajustarIntencao(intencao, texto, { ultimaIA = '' } = {}) {
    const t = String(texto || '').trim();
    const ia = String(ultimaIA || '');

    if (intencao === 'OBJECAO') {
        if (RE_OBJECAO_EXPLICITA.test(t)) return 'OBJECAO';
        if (RE_NAO_SECO.test(t) && RE_IA_CONVIDOU.test(ia)) return 'OBJECAO';
        return 'DUVIDA';
    }
    if (intencao === 'REPASSE') {
        if (RE_REPASSE_EXPLICITO.test(t) || RE_IA_PERGUNTOU_DECISOR.test(ia)) return 'REPASSE';
        return 'DUVIDA';
    }
    return intencao;
}

module.exports = { ajustarIntencao, RE_OBJECAO_EXPLICITA, RE_REPASSE_EXPLICITO };
