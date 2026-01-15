/**
 * 3_enrich.js - MÓDULO DE INTELIGÊNCIA CORPORATIVA V5 (MASTER ARCHITECTURE)
 * Focado em: Discovery de CNPJ, Validação de Identidade e Extração de Decisores.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const https = require('https');
const stringSimilarity = require('string-similarity');

puppeteer.use(StealthPlugin());

// Rotação de User-Agents para evitar Fingerprinting
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

/**
 * Consulta API Pública do Governo (BrasilAPI)
 * Retorna dados fiscais oficiais.
 */
async function consultarDadosOficiais(cnpj) {
    return new Promise((resolve) => {
        const req = https.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
            headers: { 'User-Agent': 'SDR-Master-Bot/5.0' },
            timeout: 10000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                } else {
                    resolve(null);
                }
            });
        });
        
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

/**
 * Formata strings para "Title Case"
 */
function titleCase(str) {
    if (!str) return null;
    return str.toLowerCase().replace(/(?:^|\s)\S/g, a => a.toUpperCase());
}

/**
 * MOTOR DE ENRIQUECIMENTO
 * Recebe um lead limpo e retorna um lead enriquecido com inteligência fiscal.
 */
async function enriquecerLeadIndividual(lead) {
    // 1. Setup de Segurança e Performance
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'] 
    });
    
    const page = await browser.newPage();
    
    // Bloqueio Agressivo de Recursos (Economia de Banda e CPU para SaaS)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'font', 'stylesheet', 'media', 'other'].includes(type)) req.abort();
        else req.continue();
    });

    // Objeto de Retorno Padrão (Merge Safe)
    let enrichment = {
        cnpj: null,
        razao_social: null,
        nome_fantasia: null,
        dono: null,           // O "Alvo" (Decisor)
        celular_fiscal: null, // Telefone registrado na Receita
        capital_social: 0,
        atividade_principal: null,
        data_abertura: null,
        status_receita: null,
        match_confidence: 0,  // 0 a 100
        enriched: false,
        enrich_source: null
    };

    try {
        await page.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);

        // 2. BUSCA DE CNPJ (OSINT - Open Source Intelligence)
        // Usamos Bing pois o Google bloqueia IPs de datacenter muito rápido.
        // Query otimizada: Nome + Cidade + CNPJ
        const termoBusca = `"${lead.name.replace(/[^\w\s]/gi, '')}" ${lead.cidade || ""} CNPJ`;
        
        await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(termoBusca)}`, { 
            waitUntil: 'domcontentloaded', 
            timeout: 15000 
        });

        // Extração de Texto do corpo da busca
        const bodyText = await page.evaluate(() => document.body.innerText);
        
        // Regex de CNPJ Estrito
        const cnpjMatch = bodyText.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);

        if (cnpjMatch) {
            const cnpjLimpo = cnpjMatch[0].replace(/\D/g, '');
            
            // 3. VALIDAÇÃO OFICIAL (Cross-Check)
            const dadosFiscais = await consultarDadosOficiais(cnpjLimpo);

            if (dadosFiscais) {
                // --- A. ALGORITMO DE MATCH DE IDENTIDADE ---
                // Compara o nome que o Scraper achou no Maps com a Razão Social/Fantasia da Receita.
                // Isso evita ligar para a empresa errada.
                const nomeMaps = lead.name.toUpperCase();
                const razao = (dadosFiscais.razao_social || "").toUpperCase();
                const fantasia = (dadosFiscais.nome_fantasia || "").toUpperCase();

                const scoreRazao = stringSimilarity.compareTwoStrings(nomeMaps, razao);
                const scoreFantasia = stringSimilarity.compareTwoStrings(nomeMaps, fantasia);
                
                // Define a confiança baseada no melhor match
                enrichment.match_confidence = Math.max(scoreRazao, scoreFantasia) * 100;

                // Regra de Corte: Só aceita se tiver > 40% de similaridade OU se a cidade bater exatamente
                const cidadeBate = lead.cidade && dadosFiscais.municipio && 
                                   lead.cidade.toLowerCase().includes(dadosFiscais.municipio.toLowerCase());

                if (enrichment.match_confidence > 40 || (enrichment.match_confidence > 25 && cidadeBate)) {
                    
                    enrichment.cnpj = cnpjMatch[0];
                    enrichment.razao_social = titleCase(dadosFiscais.razao_social);
                    enrichment.nome_fantasia = titleCase(dadosFiscais.nome_fantasia);
                    enrichment.status_receita = dadosFiscais.descricao_situacao_cadastral;
                    enrichment.data_abertura = dadosFiscais.data_inicio_atividade;
                    enrichment.capital_social = parseFloat(dadosFiscais.capital_social || 0);
                    enrichment.atividade_principal = dadosFiscais.cnae_fiscal_descricao;
                    enrichment.enrich_source = 'BrasilAPI_Verified';
                    enrichment.enriched = true;

                    // --- B. EXTRAÇÃO DO SÓCIO ADMINISTRADOR (DECISOR) ---
                    if (dadosFiscais.qsa && Array.isArray(dadosFiscais.qsa)) {
                        // Prioridade 1: Sócio-Administrador (Cód 49)
                        // Prioridade 2: Titular Pessoa Física (Cód 65 - MEIs/Individuais)
                        // Prioridade 3: Qualquer sócio listado
                        const socioAdmin = dadosFiscais.qsa.find(s => 
                            s.qualificacao_socio_administrador?.code == 49 || 
                            s.qualificacao_socio_administrador?.code == 65
                        ) || dadosFiscais.qsa[0];

                        if (socioAdmin) {
                            let nomeSocio = socioAdmin.nome_socio || socioAdmin.nome;
                            enrichment.dono = titleCase(nomeSocio);
                        }
                    }

                    // --- C. EXTRAÇÃO DE CONTATO FISCAL ---
                    if (dadosFiscais.ddd_telefone_1 && dadosFiscais.telefone_1) {
                        enrichment.celular_fiscal = `(${dadosFiscais.ddd_telefone_1}) ${dadosFiscais.telefone_1}`;
                    }
                }
            }
        }

    } catch (erro) {
        // Log silencioso para não poluir o terminal principal, erros aqui não devem parar o fluxo
        // console.error(`[ENRICH WARN] Falha ao enriquecer ${lead.name}: ${erro.message}`);
    } finally {
        await browser.close();
    }

    // --- CÁLCULO DE SCORE FINAL (Quality Score V2) ---
    // Atualiza o score do lead baseado nos dados financeiros descobertos
    let finalScore = lead.quality_score || 50;

    if (enrichment.enriched) {
        // Empresa Ativa ganha pontos
        if (enrichment.status_receita === 'ATIVA') finalScore += 10;
        
        // Capital Social alto indica poder de compra
        if (enrichment.capital_social > 100000) finalScore += 20;
        else if (enrichment.capital_social > 20000) finalScore += 10;

        // Decisor identificado é ouro
        if (enrichment.dono) finalScore += 15;

        // Penalidade se o CNPJ não estiver ativo
        if (enrichment.status_receita && enrichment.status_receita !== 'ATIVA') finalScore -= 100;
    }

    return { 
        ...lead, 
        ...enrichment, 
        quality_score: Math.min(Math.max(finalScore, 0), 100) // Clamp entre 0 e 100
    };
}

module.exports = { enriquecerLeadIndividual };