'use strict';
// lib/textPuros.js — Funções PURAS de identidade/nome (sem I/O, sem side effects).
// Extraídas de 4_sdr.js para poderem ser importadas em testes sem subir Redis/BullMQ/Baileys.
// O 4_sdr.js consome daqui; a lógica é a mesma, só mudou de lugar.

// 👤 FILTRO DE IDENTIDADE HUMANA: Valida se o nome do WhatsApp é realmente de uma pessoa.
function extrairNomeHumano(pushName) {
    if (!pushName) return null;

    // 1. Remove emojis e caracteres estranhos, deixando só letras e espaços
    let nomeLimpo = pushName.replace(/[^\p{L}\s]/gu, '').trim();
    if (!nomeLimpo || nomeLimpo.length < 2) return null;

    // 2. Pega só a primeira palavra para evitar nomes longos ou compostos estranhos
    const primeiroNome = nomeLimpo.split(/\s+/)[0].toLowerCase();

    // 3. Blacklist de palavras que parecem empresa ou lixo
    const palavrasProibidas = [
        'ltda', 'me', 'epp', 'eireli', 'mei', 'sa', 'loja', 'store', 'modas',
        'pizzaria', 'lanchonete', 'hamburgueria', 'padaria', 'restaurante',
        'oficina', 'mecanica', 'auto', 'center', 'estetica', 'salao', 'clinica',
        'farmacia', 'drogaria', 'imoveis', 'imobiliaria', 'tech', 'info', 'cell',
        'imports', 'atacado', 'varejo', 'distribuidora', 'comercio', 'servicos',
        'adm', 'financeiro', 'vendas', 'atendimento', 'suporte', 'contato',
        // reforço: mais termos de empresa/setor que apareciam como "nome" bizarro
        'grupo', 'cia', 'mercado', 'super', 'supermercado', 'express', 'delivery',
        'buffet', 'confeitaria', 'acougue', 'bar', 'pub', 'hotel', 'pousada', 'moveis',
        'construtora', 'transportes', 'industria', 'fabrica', 'depa', 'deposito', 'empresa'
    ];

    if (palavrasProibidas.includes(primeiroNome)) return null;
    // Barra tokens sem vogal (siglas/lixo tipo "jj", "xpto") — nome de pessoa sempre tem vogal.
    if (!/[aeiouáéíóúâêôãõà]/i.test(primeiroNome)) return null;

    // 4. Retorna o nome com a primeira letra maiúscula (Ex: "joão" -> "João")
    return primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1);
}

// 👋 Saudação por primeiro nome SÓ quando é nome humano de verdade. Passa pelo mesmo filtro:
// se não for nome de pessoa, devolve o fallback neutro. Evita "Oi, Padaria Ltda".
function saudacaoPrimeiroNome(dono, fallback = '') {
    return extrairNomeHumano(dono) || fallback;
}

// 🗣️ Extrai o nome que o LEAD declara na conversa ("meu nome é Carlos", "aqui é o João",
// "sou a Ana", "me chamo..."). Alta confiança. Valida com extrairNomeHumano. Retorna nome ou null.
const PADROES_NOME_DECLARADO = [
    /\bmeu nome (?:é|e|eh)\s+([A-Za-zÀ-ÿ]{2,})/i,
    /\bme chamo\s+([A-Za-zÀ-ÿ]{2,})/i,
    /\b(?:aqui (?:é|e|eh)|quem fala (?:é|e|eh)|é|e|eh)\s+(?:o|a)\s+([A-Za-zÀ-ÿ]{2,})\s+(?:falando|aqui)/i,
    /\baqui (?:é|e|eh)\s+(?:o|a)\s+([A-Za-zÀ-ÿ]{2,})/i,
    /\bsou (?:o|a)\s+([A-Za-zÀ-ÿ]{2,})/i,
    /\bpode me chamar de\s+([A-Za-zÀ-ÿ]{2,})/i,
];
function extrairNomeDeclarado(texto) {
    if (!texto || typeof texto !== 'string') return null;
    for (const padrao of PADROES_NOME_DECLARADO) {
        const m = texto.match(padrao);
        if (m && m[1]) {
            const validado = extrairNomeHumano(m[1]);
            if (validado) return validado;
        }
    }
    return null;
}

// 🏢 Decide se dá pra AFIRMAR o nome da empresa do lead — ou se é melhor não presumir nada.
// O bug: em lead inbound orgânico, lead.name = pushName do WhatsApp (nome de PESSOA, ex:
// "Matheus Flaris"), não empresa. Sem sinal real de empresa (CNPJ/nicho/capital), afirmar
// "Empresa: Matheus Flaris" faz a IA tratar o nome da pessoa como se fosse a empresa dela.
// Retorna o nome da empresa quando é confiável, ou null quando NÃO se deve presumir.
function empresaConfiavelDoLead(lead) {
    if (!lead || typeof lead !== 'object') return null;
    const nome = (lead.name || '').trim();
    if (!nome) return null;

    // Sinais fortes de empresa real (veio de enriquecimento CNPJ / scraping do Maps)
    const temSinalEmpresa =
        !!lead.cnpj ||
        !!lead.niche ||
        Number(lead.capital_social_numeric) > 0 ||
        lead.origin === 'scraper' ||
        lead.origin === 'cnpj';
    if (temSinalEmpresa) return nome;

    // Sem sinal de empresa: se o name é claramente nome de PESSOA (pushName), não afirmar empresa
    if (extrairNomeHumano(nome)) return null;

    // Contatos genéricos criados pelo sistema também não são empresa
    if (/^(contato|cliente|lead)\b/i.test(nome) || /org[âa]nico/i.test(nome)) return null;

    // Ambíguo com 2+ palavras e não-pessoa (ex: "Padaria Central") → provavelmente é empresa
    return nome.split(/\s+/).length >= 2 ? nome : null;
}

module.exports = { extrairNomeHumano, saudacaoPrimeiroNome, extrairNomeDeclarado, PADROES_NOME_DECLARADO, empresaConfiavelDoLead };
