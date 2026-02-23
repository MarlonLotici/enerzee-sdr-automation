/**
 * 2_clean.js - MÓDULO DE REFINARIA DE DADOS V6 (BLINDADO)
 * Correções: Prevenção de Crash de DB, Extração de Bairro e Proteção de Status.
 */

const SUFIXOS_JURIDICOS = [' LTDA', ' S.A', ' S/A', ' ME', ' EPP', ' EIRELI', ' MEI', ' - ME', ' - EPP', ' LIMITADA', ' INC', ' COMERCIO'];
const PREPOSICOES = ['da', 'de', 'do', 'das', 'dos', 'e', 'em', 'para', 'com'];

function humanizarNome(nomeBruto) {
    if (!nomeBruto) return "Empresa Sem Nome";
    // Remove caracteres especiais mas mantém acentos e &
    let nome = nomeBruto.replace(/[^\w\s\u00C0-\u00FF&]/g, ' ').replace(/\s+/g, ' ').trim();
    
    const nomeUpper = nome.toUpperCase();
    for (const sufixo of SUFIXOS_JURIDICOS) {
        if (nomeUpper.endsWith(sufixo)) {
            nome = nome.substring(0, nome.length - sufixo.length).trim();
        }
    }

    return nome.toLowerCase().split(' ').map((palavra, index) => {
        if (index > 0 && PREPOSICOES.includes(palavra)) return palavra;
        return palavra.charAt(0).toUpperCase() + palavra.slice(1);
    }).join(' ');
}

// Tenta extrair o bairro de endereços no formato "Rua, Num - Bairro, Cidade"
function extrairBairro(endereco, cidade) {
    if (!endereco) return null;
    try {
        // Lógica: Geralmente o bairro está entre o hífen e a vírgula da cidade
        // Ex: "Rua A, 123 - Centro, Santo André"
        const partes = endereco.split('-');
        if (partes.length > 1) {
            const posHifen = partes[partes.length - 1]; // " Centro, Santo André..."
            const bairroSujo = posHifen.split(',')[0]; // " Centro"
            const bairroLimpo = bairroSujo.trim();
            
            // Validação básica para não pegar número de telefone ou CEP como bairro
            if (bairroLimpo.length > 2 && isNaN(parseInt(bairroLimpo))) {
                return bairroLimpo;
            }
        }
    } catch (e) { return null; }
    return null;
}

function analisarTelefone(telefoneBruto) {
    if (!telefoneBruto) return { valido: false, motivo: 'vazio' };
    
    let numeros = telefoneBruto.replace(/\D/g, '');
    
    if (numeros.startsWith('0800') || numeros.startsWith('0300')) return { valido: false, motivo: '0800' };
    
    // Garante DDI 55
    if (numeros.length === 10 || numeros.length === 11) {
        numeros = '55' + numeros;
    }

    // Corrige bug comum de scraper duplicar 55 (ex: 555511999...)
    if (numeros.length > 13 && numeros.startsWith('5555')) {
        numeros = numeros.substring(2);
    }

    // Tamanho inválido pós-tratamento
    if (numeros.length !== 12 && numeros.length !== 13) {
        return { valido: false, motivo: 'tamanho_invalido', original: telefoneBruto };
    }

    const ddd = parseInt(numeros.substring(2, 4));
    if (ddd < 11 || ddd > 99) return { valido: false, motivo: 'ddd_invalido' };

    let tipo = 'landline';
    const primeiroDigito = parseInt(numeros[4]);
    if (numeros.length === 13 && primeiroDigito === 9) {
        tipo = 'mobile';
    }

    const dddFormat = numeros.substring(2, 4);
    const parte1 = numeros.length === 13 ? numeros.substring(4, 9) : numeros.substring(4, 8);
    const parte2 = numeros.substring(numeros.length - 4);

    return {
        valido: true,
        tipo: tipo,
        // CRUCIAL: Formato correto para o Baileys disparar
        whatsappId: `${numeros}@s.whatsapp.net`, 
        visual: `+55 (${dddFormat}) ${parte1}-${parte2}`,
        numeros: numeros
    };
}

function processarLimpeza(leadsBrutos) {
    const leadsRefinados = [];
    const hashDuplicidade = new Set();

    for (const raw of leadsBrutos) {
        const foneInfo = analisarTelefone(raw.phone);
        
        if (!foneInfo.valido) continue;
        if (hashDuplicidade.has(foneInfo.numeros)) continue;
        
        hashDuplicidade.add(foneInfo.numeros);

        const nomeLimpo = humanizarNome(raw.name || raw.title);
        
        // Tenta achar o bairro se o scraper não trouxe
        const bairroFinal = raw.bairro || extrairBairro(raw.address, raw.city) || null;

        const leadPronto = {
            id: raw.id || Date.now() + Math.random(),
            
            // Dados Principais
            name: nomeLimpo,
            valido: true,
            
            // Contato
            phone: foneInfo.visual,
            whatsappId: foneInfo.whatsappId, // @s.whatsapp.net
            type: foneInfo.tipo,
            
            // Dados Geográficos e Segmentação
            city: raw.city || "",
            niche: raw.niche,
            endereco_fiscal: raw.address || "Endereço não identificado",
            bairro: bairroFinal, // Agora populado!
            link_maps: raw.link || raw.link_maps,
            
            // Metadados
            rating: raw.rating || "N/A",
            reviews: raw.reviews || 0,
            
            // --- CAMPOS DE PROTEÇÃO (Evitam Crash no Banco) ---
            // Se o enriquecimento falhar, esses valores padrão salvam o insert
            cnpj: null,
            dono: null,
            porte: null,
            capital_social: "R$ 0,00",
            capital_social_numeric: 0, 
            cep: null,

            // Flags
            // REMOVI O 'status: new' DAQUI. 
            // O database.js deve lidar com isso (se não existir, cria new. Se existir, não mexe).
            // Mas, para garantir que o saveLead funcione na sua versão atual, 
            // vamos enviar 'new' apenas se não tivermos certeza.
            status: 'new', 
            enriched: false,
            
            quality_score: calcularScoreInicial(raw, foneInfo)
        };

        leadsRefinados.push(leadPronto);
    }

    return leadsRefinados;
}

function calcularScoreInicial(raw, foneInfo) {
    let score = 50;
    if (foneInfo.tipo === 'mobile') score += 20;
    
    const reviews = parseInt(raw.reviews) || 0;
    if (reviews > 50) score += 10;
    
    // Tratamento seguro para rating que pode vir como string "4,5"
    const rating = parseFloat(String(raw.rating).replace(',', '.')) || 0;
    if (rating > 4.0) score += 5;
    
    if (raw.address && raw.address.length > 15) score += 10;
    
    return Math.min(score, 100);
}

module.exports = { processarLimpeza };