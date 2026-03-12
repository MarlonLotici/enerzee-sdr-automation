/**
 * 3_enrich.js - MÓDULO V11 (DATA PLUS)
 * Lógica V10 (DuckDuckGo Open) + Extração Avançada de Endereço e CNAEs.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const https = require('https');
const stringSimilarity = require('string-similarity');

puppeteer.use(StealthPlugin());

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

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
                } else { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

function titleCase(str) {
    if (!str) return null;
    return str.toLowerCase().replace(/(?:^|\s)\S/g, a => a.toUpperCase());
}

async function enriquecerLeadIndividual(lead) {
    console.log(`[DIAGNÓSTICO] Recebendo lead: ${lead.name} | Cidade: ${lead.city}`);
    
    // MODO VISUAL LIGADO
    const browser = await puppeteer.launch({ 
        headless: true, 
        defaultViewport: null,
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(45000);
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    // Objeto expandido com novos campos
    let enrichment = {
        cnpj: null, 
        razao_social: null, 
        nome_fantasia: null,
        dono: null, 
        celular_fiscal: null, 
        capital_social: 0,
        atividade_principal: null, 
        atividades_secundarias: [], // NOVO
        data_abertura: null,
        status_receita: null, 
        porte: null, // NOVO
        endereco_fiscal: null, // NOVO (Endereço perfeito)
        bairro: null, // NOVO
        cep: null, // NOVO
        match_confidence: 0, 
        enriched: false
    };

    await new Promise(r => setTimeout(r, 2000));

    try {
        await page.setUserAgent(USER_AGENTS[0]);

        // --- LÓGICA DE BUSCA V10 (MANTIDA) ---
        let termoBusca = "";
        const localidade = lead.city || lead.cidade || "";
        let nomeLimpo = lead.name.replace(/["-]/g, ' ').trim(); 

        if (nomeLimpo.includes("Supermercado")) {
             // Lógica para focar na marca se necessário
        }

        if (localidade.length > 2) {
            termoBusca = `${nomeLimpo} ${localidade} CNPJ`;
        } else {
            termoBusca = `${nomeLimpo} CNPJ`;
        }

        console.log(`[ENRICH] 🦆 Buscando no DuckDuckGo (Data Plus): ${termoBusca}`);
        
        await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(termoBusca)}&t=h_&ia=web`, { 
            waitUntil: 'domcontentloaded' 
        });

        try { await page.waitForSelector('#react-layout', { timeout: 8000 }); } catch (e) {}
        await new Promise(r => setTimeout(r, 1500));

        const bodyText = await page.evaluate(() => document.body.innerText);
        const cnpjMatch = bodyText.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);

        if (cnpjMatch) {
            console.log(`[ENRICH] ✅ CNPJ Localizado: ${cnpjMatch[0]}`);
            const cnpjLimpo = cnpjMatch[0].replace(/\D/g, '');
            const dadosFiscais = await consultarDadosOficiais(cnpjLimpo);

            if (dadosFiscais) {
                console.log(`[ENRICH] 🏛️ Dados Oficiais: ${dadosFiscais.razao_social}`);
                
                const nomeMaps = lead.name.toUpperCase();
                const razao = (dadosFiscais.razao_social || "").toUpperCase();
                const fantasia = (dadosFiscais.nome_fantasia || "").toUpperCase();
                
                const scoreRazao = stringSimilarity.compareTwoStrings(nomeMaps, razao);
                const scoreFantasia = stringSimilarity.compareTwoStrings(nomeMaps, fantasia);
                enrichment.match_confidence = Math.max(scoreRazao, scoreFantasia) * 100;

                const cidadeBate = lead.address && dadosFiscais.municipio && 
                                   lead.address.toLowerCase().includes(dadosFiscais.municipio.toLowerCase());

                if (enrichment.match_confidence > 20 || cidadeBate || (localidade && localidade.toUpperCase() === dadosFiscais.municipio)) {
                    
                    // --- CAPTURA DE DADOS EXPANDIDA (V11) ---
                    enrichment.cnpj = cnpjMatch[0];
                    enrichment.razao_social = titleCase(dadosFiscais.razao_social);
                    enrichment.nome_fantasia = titleCase(dadosFiscais.nome_fantasia);
                    enrichment.status_receita = dadosFiscais.descricao_situacao_cadastral;
                    enrichment.data_abertura = dadosFiscais.data_inicio_atividade;
                    enrichment.capital_social = parseFloat(dadosFiscais.capital_social || 0);
                    enrichment.atividade_principal = dadosFiscais.cnae_fiscal_descricao;
                    enrichment.porte = dadosFiscais.porte; // ME, EPP, etc.

                    // Captura de Atividades Secundárias (Top 3)
                    if (dadosFiscais.cnaes_secundarios && dadosFiscais.cnaes_secundarios.length > 0) {
                        enrichment.atividades_secundarias = dadosFiscais.cnaes_secundarios
                            .slice(0, 3)
                            .map(c => c.descricao);
                    }

                    // --- MELHORIA DE ENDEREÇO (AQUI ESTÁ O SEGREDO) ---
                    // Montamos o endereço oficial vindo da Receita Federal
                    const logradouro = titleCase(dadosFiscais.logradouro) || "";
                    const numero = dadosFiscais.numero || "S/N";
                    const complemento = dadosFiscais.complemento ? ` - ${dadosFiscais.complemento}` : "";
                    const bairro = titleCase(dadosFiscais.bairro) || "";
                    const cep = dadosFiscais.cep || "";
                    const uf = dadosFiscais.uf || "";

                    enrichment.bairro = bairro;
                    enrichment.cep = cep;
                    
                    // Cria uma string de endereço linda e completa
                    enrichment.endereco_fiscal = `${logradouro}, ${numero}${complemento} - ${bairro}, ${cep} (${uf})`;
                    console.log(`[ENRICH] 📍 Endereço Fiscal: ${enrichment.endereco_fiscal}`);

                    enrichment.enriched = true;

                    // Sócios
                    if (dadosFiscais.qsa && Array.isArray(dadosFiscais.qsa)) {
                        const socioAdmin = dadosFiscais.qsa.find(s => 
                            s.qualificacao_socio_administrador?.code == 49 || 
                            s.qualificacao_socio_administrador?.code == 65
                        ) || dadosFiscais.qsa[0];

                        if (socioAdmin) {
                            enrichment.dono = titleCase(socioAdmin.nome_socio || socioAdmin.nome);
                            console.log(`[ENRICH] 👤 Sócio: ${enrichment.dono}`);
                        }
                    }
                    // Telefone Fiscal
                    if (dadosFiscais.ddd_telefone_1 && dadosFiscais.telefone_1) {
                        enrichment.celular_fiscal = `(${dadosFiscais.ddd_telefone_1}) ${dadosFiscais.telefone_1}`;
                    }
                }
            }
        } else {
            console.log(`[ENRICH] ❌ Nenhum CNPJ achado.`);
            try { await page.screenshot({ path: `erro_${lead.name.replace(/[^a-z0-9]/gi, '')}.png` }); } catch(e){}
        }

    } catch (erro) {
        console.error(`[ENRICH ERROR] ${erro.message}`);
    } finally {
        try { if (browser) await browser.close(); } catch (e) {}
    }

    let finalScore = lead.quality_score || 50;
    if (enrichment.enriched) finalScore += 40;

    // Retorna tudo misturado. O Frontend pode escolher mostrar 'lead.address' (Maps) ou 'lead.endereco_fiscal' (CNPJ)
    return { ...lead, ...enrichment, quality_score: Math.min(Math.max(finalScore, 0), 100) };
}

module.exports = { enriquecerLeadIndividual };