/**
 * 2_clean.js - MÓDULO DE REFINARIA DE DADOS V5 (MASTER ARCHITECTURE)
 * Focado em: Sanitização rigorosa, Padronização de nomes e Classificação Tática.
 */

// Sufixos jurídicos que "sujam" a abordagem comercial
const SUFIXOS_JURIDICOS = [
    ' LTDA', ' S.A', ' S/A', ' ME', ' EPP', ' EIRELI', ' MEI', 
    ' - ME', ' - EPP', ' LIMITADA', ' SOCIEDADE ANONIMA', ' INC'
];

// Preposições que devem ficar em minúsculo
const PREPOSICOES = ['da', 'de', 'do', 'das', 'dos', 'e', 'em', 'para', 'com'];

/**
 * Normaliza nomes para formato de conversa humana (Title Case)
 * Ex: "PADARIA E CONFEITARIA DO JOAO - ME" -> "Padaria e Confeitaria do Joao"
 */
function humanizarNome(nomeBruto) {
    if (!nomeBruto) return "Empresa Sem Nome";

    // 1. Limpeza de caracteres estranhos comuns em scraping
    let nome = nomeBruto.replace(/[^\w\s\u00C0-\u00FF&]/g, ' ').replace(/\s+/g, ' ').trim();

    // 2. Remoção de Sufixos Jurídicos (Do fim para o começo)
    const nomeUpper = nome.toUpperCase();
    for (const sufixo of SUFIXOS_JURIDICOS) {
        if (nomeUpper.endsWith(sufixo)) {
            nome = nome.substring(0, nome.length - sufixo.length).trim();
        }
    }

    // 3. Title Case Inteligente (Respeita preposições)
    return nome.toLowerCase().split(' ').map((palavra, index) => {
        if (index > 0 && PREPOSICOES.includes(palavra)) return palavra;
        return palavra.charAt(0).toUpperCase() + palavra.slice(1);
    }).join(' ');
}

/**
 * Validador e Formatador de Telefones (Padrão BR + Internacional)
 * Retorna objeto rico com metadados do telefone.
 */
function analisarTelefone(telefoneBruto) {
    if (!telefoneBruto) return { valido: false, motivo: 'vazio' };

    // Remove tudo que não é dígito
    let numeros = telefoneBruto.replace(/\D/g, '');

    // Tratamento de 0800 (Inútil para SDR WhatsApp)
    if (numeros.startsWith('0800') || numeros.startsWith('0300')) {
        return { valido: false, motivo: '0800' };
    }

    // Tratamento de DDI (Se começar com 55 e for longo, mantém. Se não, adiciona)
    // Tamanhos comuns BR sem DDI: 10 (Fixo), 11 (Celular)
    // Tamanhos comuns BR com DDI: 12 (Fixo), 13 (Celular)
    
    if (numeros.length === 10 || numeros.length === 11) {
        numeros = '55' + numeros;
    }

    // Validação Final de Tamanho
    if (numeros.length !== 12 && numeros.length !== 13) {
        // Tenta salvar casos onde o scraper pegou "5548999..." duplicado
        if (numeros.length > 13 && numeros.startsWith('5555')) {
            numeros = numeros.substring(2); // Remove um 55 extra
        } else {
            return { valido: false, motivo: 'tamanho_invalido', original: telefoneBruto };
        }
    }

    // Classificação por Tipo (Lógica do 9º dígito e faixas de DDD)
    // Estrutura: 55 (DD) (X)XXXX-XXXX
    const ddd = parseInt(numeros.substring(2, 4));
    const primeiroDigito = parseInt(numeros[4]);

    // Validação de DDD (11 a 99)
    if (ddd < 11 || ddd > 99) return { valido: false, motivo: 'ddd_invalido' };

    let tipo = 'desconhecido';
    
    // Regra Celular: Tamanho 13 E começa com 9 no nono dígito (pós 55+DDD)
    if (numeros.length === 13 && primeiroDigito === 9) {
        tipo = 'mobile';
    } 
    // Regra Fixo: Tamanho 12 E começa entre 2 e 5
    else if (numeros.length === 12 && primeiroDigito >= 2 && primeiroDigito <= 5) {
        tipo = 'landline';
    } else {
        // Pode ser um rádio (Nextel antigo) ou celular sem o 9 (muito raro hoje em dia)
        // No contexto "Militar", se não é padrão, descartamos ou marcamos revisão.
        // Vamos marcar como fixo por segurança se tiver 12 digitos, ou invalido.
        if (numeros.length === 13) tipo = 'mobile_suspect'; 
        else return { valido: false, motivo: 'formato_invalido' };
    }

    // Formatações de Saída
    const dddFormat = numeros.substring(2, 4);
    const parte1 = numeros.length === 13 ? numeros.substring(4, 9) : numeros.substring(4, 8);
    const parte2 = numeros.substring(numeros.length - 4);

    return {
        valido: true,
        tipo: tipo,
        whatsappId: `${numeros}@c.us`, // ID Técnico para API
        visual: `+55 (${dddFormat}) ${parte1}-${parte2}`, // Visual bonito pro Card
        numeros: numeros
    };
}

/**
 * MOTOR DE LIMPEZA
 * Recebe array de leads brutos, devolve leads de elite.
 */
function processarLimpeza(leadsBrutos) {
    // console.log(`🏭 Refinaria V5: Processando ${leadsBrutos.length} itens brutos...`);
    
    const leadsRefinados = [];
    const hashDuplicidade = new Set(); // Evita processar o mesmo número 2x no lote

    for (const raw of leadsBrutos) {
        // 1. Sanitização de Telefone (Filtro Crítico)
        const foneInfo = analisarTelefone(raw.phone);

        // Se o telefone não serve, o lead não serve para SDR (pode servir para Email Mkt futuro, mas aqui filtramos)
        if (!foneInfo.valido) {
            continue; 
        }

        // 2. Deduplicação (Anti-Spam Interno)
        if (hashDuplicidade.has(foneInfo.numeros)) {
            continue;
        }
        hashDuplicidade.add(foneInfo.numeros);

        // 3. Higiene de Nome
        const nomeLimpo = humanizarNome(raw.name || raw.title);

        // 4. Montagem do Objeto Tático
        const leadPronto = {
            id: raw.id || Date.now() + Math.random(), // Garante ID
            
            // Dados de Identificação
            name: nomeLimpo,
            original_name: raw.name,
            valido: true, // <--- ADICIONE ESTA LINHA AQUI
            city: raw.city,
            // Dados de Contato
            phone: foneInfo.visual,
            whatsappId: foneInfo.whatsappId,
            type: foneInfo.tipo, // 'mobile' ou 'landline'
            
            // Metadados de Origem
            niche: raw.niche,
            rating: raw.rating || "N/A",
            reviews: raw.reviews || 0,
            address: raw.address,
            link_maps: raw.link,
            
            // Flags de Estado
            status: 'new', // Novo no CRM
            enriched: false, // Ainda não passou pelo step 3
            
            // Score Inicial (Baseado na qualidade dos dados brutos)
            quality_score: calcularScoreInicial(raw, foneInfo)
        };

        leadsRefinados.push(leadPronto);
    }

    return leadsRefinados;
}

/**
 * Calcula um score preliminar (0-100) baseado apenas no que veio do Maps
 * Ajuda a ordenar visualmente quais leads parecem mais promissores antes mesmo de enriquecer.
 */
function calcularScoreInicial(raw, foneInfo) {
    let score = 50; // Base

    // Tem celular? (Mais fácil de contatar)
    if (foneInfo.tipo === 'mobile') score += 20;

    // Tem muitas avaliações? (Empresa real e ativa)
    const reviews = parseInt(raw.reviews) || 0;
    if (reviews > 50) score += 10;
    if (reviews > 100) score += 5;

    // Tem nota alta?
    const rating = parseFloat(raw.rating?.replace(',', '.')) || 0;
    if (rating > 4.0) score += 5;

    // Tem endereço completo?
    if (raw.address && raw.address.length > 10) score += 10;

    return Math.min(score, 100);
}

module.exports = { processarLimpeza };