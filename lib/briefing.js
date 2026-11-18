'use strict';
/**
 * Briefing de reunião (vai pro Discord do cliente quando a IA agenda) e rascunho de proposta (Antix, depois da
 * reunião). Aqui só montagem de prompt e de texto (PURO, testável). A chamada ao LLM e o envio ficam no chamador.
 */

const _txt = (m) => String(m?.content || '').replace(/\[\s*[ÁA]UDIO[\s_-]*TTS\s*\]/gi, '').replace(/\[[A-Z_]+(:[^\]]*)?\]/g, '').trim();

/** Conversa em texto corrido, só o que o lead e a IA disseram (sem marcadores internos), cortada no fim. */
function transcricao(historico = [], max = 9000) {
    const linhas = historico
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && _txt(m))
        .map(m => `${m.role === 'user' ? 'LEAD' : 'IA'}: ${_txt(m)}`);
    const t = linhas.join('\n');
    return t.length > max ? '…' + t.slice(-max) : t;
}

function promptBriefing({ historico, nomeLead, empresaCliente, contextoNegocio, quando }) {
    return `Você prepara o briefing de uma reunião de vendas para o vendedor da empresa "${empresaCliente}". Ele vai ler no celular minutos antes da reunião.
O que a empresa vende (contexto, use só para entender a oferta):
"""
${String(contextoNegocio || '').slice(0, 2500)}
"""
Reunião: ${quando || 'agendada'} com ${nomeLead || 'o lead'}.
Conversa completa entre o lead e a IA de atendimento:
"""
${transcricao(historico)}
"""
Escreva o briefing em português do Brasil, direto, com estes blocos e nada mais (cada bloco com 1 a 3 linhas):
**Quem é:** o que a pessoa ou empresa faz e o papel dela (só o que foi dito).
**Dor principal:** nas palavras do próprio lead.
**Números citados:** volumes, valores, equipe, metas. Se não citou, escreva "nenhum".
**O que já foi mostrado:** o que a IA apresentou e o que o lead validou.
**Dúvidas e objeções:** o que ele perguntou ou questionou. Se nada, "nenhuma".
**Temperatura:** quente, morno ou frio, e por quê em uma frase.
**Como abrir a reunião:** uma sugestão de primeira frase e o ponto a aprofundar.
REGRAS: não invente nada que não esteja na conversa. Sem introdução e sem despedida.`;
}

const OFERTA_ANTIX_PADRAO = `Oferta "Cliente Fundador" (válida para os 5 primeiros): R$597 de entrada (implantação e 1º mês), depois R$597 por mês sem fidelidade, ou plano de 12 meses a R$450 por mês com site de bônus. Implantação em até 48 horas num número novo só para o anúncio. Garantia: se em 14 dias o cliente não quiser continuar, devolvemos os R$597.`;

function promptProposta({ historico, nomeLead, oferta = OFERTA_ANTIX_PADRAO }) {
    return `Você escreve o RASCUNHO de uma proposta comercial da Antix (agentes de inteligência artificial para o comercial: SDR que atende e qualifica e agenda, BDR que prospecta, Pós-vendas que atende e reativa clientes) para ${nomeLead || 'o lead'}. O vendedor vai revisar e enviar pelo WhatsApp depois da reunião.
Conversa do lead com a IA antes da reunião:
"""
${transcricao(historico)}
"""
Oferta vigente (use exatamente estes valores e condições, sem inventar outros):
${oferta}
Escreva em português do Brasil, tom de conversa de WhatsApp, curto (no máximo 12 linhas):
1) Uma frase retomando a dor dele com as palavras dele.
2) O que vamos implantar (o agente certo para essa dor) e o resultado esperado, sem prometer número.
3) A oferta com preço, prazo e garantia.
4) Próximo passo claro (ex.: "se fizer sentido, te mando o link do PIX e começamos a implantação amanhã").
REGRAS: não invente clientes, cases, números de resultado nem desconto. Sem markdown pesado.`;
}

/** Cabeçalho fixo do briefing (dados que o código já tem). */
function cabecalhoBriefing({ nomeLead, telefone, email, quando, meetLink }) {
    const tel = String(telefone || '').replace(/\D/g, '');
    return [
        `👤 **${nomeLead || 'Lead'}**${tel ? ` · [WhatsApp](https://wa.me/${tel})` : ''}${email ? ` · ${email}` : ''}`,
        `📅 ${quando || '—'}${meetLink ? ` · [Meet](${meetLink})` : ''}`,
    ].join('\n');
}

/** Reunião terminou há pouco e ainda vale mandar a proposta? (entre 45 min e 6 h depois do início) */
function reuniaoTerminouAgora(inicioISO, agoraMs = Date.now()) {
    const t = Date.parse(inicioISO || '');
    if (!Number.isFinite(t)) return false;
    const passou = agoraMs - t;
    return passou >= 45 * 60 * 1000 && passou <= 6 * 3600 * 1000;
}

module.exports = { transcricao, promptBriefing, promptProposta, cabecalhoBriefing, reuniaoTerminouAgora, OFERTA_ANTIX_PADRAO };
