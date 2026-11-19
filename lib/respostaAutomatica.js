'use strict';
/**
 * Detecta a RESPOSTA AUTOMÁTICA do WhatsApp Business do contato ("Agradecemos sua mensagem. Não estamos
 * disponíveis no momento, mas entraremos em contato...") — texto escrito por uma configuração, não por uma pessoa.
 *
 * Bug 2026-11-18 (Lucas/ANSI): a mensagem automática dele chegou segundos depois do nosso reengajamento, a Sofia
 * a tratou como pessoa (respondeu "Sem problema! Quando tiver um tempinho...") e ela ainda contou como "pergunta de
 * descoberta respondida" no ciclo de venda, empurrando a conversa pra solução cedo demais. O caminho Baileys já tinha
 * `analisarIntencaoRegex`; o caminho OFICIAL (Cloud API) não tinha nada.
 *
 * Função PURA (sem I/O). Marcador gravado no histórico: o mesmo `[AUTORESPOSTA]` que o resto do sistema já entende
 * (painel, salvamento, reengajamento, ciclo de venda).
 */

// Fortes: texto de configuração, dificilmente escrito por uma pessoa de improviso. Bastam sozinhos.
const FORTES = [
    /agradecemos\s+(?:a\s+|sua\s+|pela\s+|o\s+)?(?:sua\s+)?(?:mensagem|contato)/i,
    /escolha\s+(?:o|um)\s+servi[çc]o/i,
    /clique\s+no\s+link/i,
    /n[ãa]o\s+estamos\s+dispon[íi]veis\s+(?:no\s+momento|agora|neste\s+momento)/i,
    /(?:no\s+momento\s+)?n[ãa]o\s+(?:podemos|conseguimos)\s+(?:te\s+)?atender/i,
    /(?:mensagem|resposta)\s+autom[áa]tica/i,
    /atendimento\s+autom[áa]tico/i,
    /fora\s+do\s+hor[áa]rio\s+de\s+(?:atendimento|funcionamento|expediente)/i,
    /nosso\s+hor[áa]rio\s+de\s+(?:atendimento|funcionamento)/i,
    /(?:digite|pressione|selecione|escolha)\s+(?:a\s+)?(?:op[cç][ãa]o\s+)?\d/i,
];

// Fracos: uma pessoa também escreve ("entro em contato", "te respondo em breve"). Só valem com tempo curto
// (a resposta chegou segundos depois da nossa fala) ou quando aparecem 2 juntos.
const FRACOS = [
    /(?:agradece|obrigad[oa]s?)\s+(?:o\s+|seu\s+|pelo\s+)?(?:seu\s+)?contato/i,
    /entraremos\s+em\s+contato/i,
    /retornaremos/i,
    /responderemos/i,
    /assim\s+que\s+poss[íi]vel/i,
    /em\s+breve/i,
    /nossa\s+equipe\s+(?:ir[aá]|vai|retornar[aá])/i,
];

const LIMITE_SEGUNDOS_RESPOSTA_ROBO = 20;
const TAMANHO_MAXIMO = 400; // robô manda texto curto de boas-vindas; mensagem longa é conversa de gente

/**
 * @param {object} p
 * @param {string} p.texto
 * @param {number|null} [p.segundosDesdeNossaFala] tempo entre a nossa última fala e esta mensagem
 * @returns {{ automatica: boolean, motivo: string }}
 */
function pareceRespostaAutomatica({ texto, segundosDesdeNossaFala = null } = {}) {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > TAMANHO_MAXIMO) return { automatica: false, motivo: '' };
    if (/^\s*\(\s*[ÁA]udio\s*\)/i.test(t) || /^\s*\[/.test(t)) return { automatica: false, motivo: '' }; // áudio/marcadores

    const forte = FORTES.find(re => re.test(t));
    if (forte) return { automatica: true, motivo: `texto de configuração (${forte.source.slice(0, 40)})` };

    const fracos = FRACOS.filter(re => re.test(t)).length;
    const rapida = Number.isFinite(segundosDesdeNossaFala) && segundosDesdeNossaFala >= 0
        && segundosDesdeNossaFala <= LIMITE_SEGUNDOS_RESPOSTA_ROBO;
    if (fracos >= 2) return { automatica: true, motivo: 'vários sinais de resposta pronta' };
    if (fracos === 1 && rapida) return { automatica: true, motivo: `resposta pronta chegou em ${Math.round(segundosDesdeNossaFala)}s` };

    return { automatica: false, motivo: '' };
}

/** Mensagem gravada no histórico como autoresposta (marcador compartilhado com o resto do sistema). */
const ehMarcadaComoAutoresposta = (content) => /^\s*\[AUTORESPOSTA\]/i.test(String(content || ''));

module.exports = { pareceRespostaAutomatica, ehMarcadaComoAutoresposta, LIMITE_SEGUNDOS_RESPOSTA_ROBO };
