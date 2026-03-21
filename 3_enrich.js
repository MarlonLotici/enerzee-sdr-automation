/**
 * 3_enrich.js - MÓDULO V11 (DATA PLUS)
 * Lógica V10 (DuckDuckGo Open) + Extração Avançada de Endereço e CNAEs.
 */


const https = require('https');
const stringSimilarity = require('string-similarity');



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
    console.log(`[ENRICH] Enriquecendo: ${lead.name} | ${lead.city}`);
    // Delay humano entre chamadas para não ser bloqueado
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    let enrichment = {
        cnpj: null, razao_social: null, nome_fantasia: null,
        dono: null, capital_social: 0, capital_social_numeric: 0,
        atividade_principal: null, porte: null,
        endereco_fiscal: null, bairro: null, cep: null,
        match_confidence: 0, enriched: false
    };

    try {
        const localidade = lead.city || "";
        const nomeLimpo = lead.name.replace(/["-]/g, ' ').trim();
        const termoBusca = localidade.length > 2
            ? `${nomeLimpo} ${localidade} CNPJ`
            : `${nomeLimpo} CNPJ`;

        console.log(`[ENRICH] 🦆 Buscando: ${termoBusca}`);

        // DuckDuckGo lite — sem Puppeteer
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(termoBusca)}`;
        const bodyText = await new Promise((resolve) => {
            const req = https.get(ddgUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html',
                },
                timeout: 15000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });
            req.on('error', () => resolve(''));
            req.on('timeout', () => { req.destroy(); resolve(''); });
        });

        const cnpjMatch = bodyText.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);

        if (!cnpjMatch) {
            console.log(`[ENRICH] ❌ CNPJ não encontrado para ${lead.name}`);
            return { ...lead, ...enrichment };
        }

        console.log(`[ENRICH] ✅ CNPJ: ${cnpjMatch[0]}`);
        const cnpjLimpo = cnpjMatch[0].replace(/\D/g, '');
        const dadosFiscais = await consultarDadosOficiais(cnpjLimpo);

        if (!dadosFiscais) return { ...lead, ...enrichment };

        const nomeMaps = lead.name.toUpperCase();
        const razao = (dadosFiscais.razao_social || "").toUpperCase();
        const fantasia = (dadosFiscais.nome_fantasia || "").toUpperCase();

        const scoreRazao = stringSimilarity.compareTwoStrings(nomeMaps, razao);
        const scoreFantasia = stringSimilarity.compareTwoStrings(nomeMaps, fantasia);
        enrichment.match_confidence = Math.max(scoreRazao, scoreFantasia) * 100;

        const cidadeBate = dadosFiscais.municipio &&
            (lead.city || "").toLowerCase().includes(dadosFiscais.municipio.toLowerCase());

        if (enrichment.match_confidence > 20 || cidadeBate) {
            enrichment.cnpj              = cnpjMatch[0];
            enrichment.razao_social      = titleCase(dadosFiscais.razao_social);
            enrichment.nome_fantasia     = titleCase(dadosFiscais.nome_fantasia);
            enrichment.porte             = dadosFiscais.porte;
            enrichment.capital_social    = parseFloat(dadosFiscais.capital_social || 0);
            enrichment.capital_social_numeric = parseFloat(dadosFiscais.capital_social || 0);
            enrichment.atividade_principal = dadosFiscais.cnae_fiscal_descricao;
            enrichment.bairro            = titleCase(dadosFiscais.bairro) || lead.bairro;
            enrichment.cep               = dadosFiscais.cep;
            enrichment.endereco_fiscal   = [
                titleCase(dadosFiscais.logradouro),
                dadosFiscais.numero || 'S/N',
                titleCase(dadosFiscais.bairro),
                dadosFiscais.cep,
                dadosFiscais.uf
            ].filter(Boolean).join(', ');
            enrichment.enriched          = true;

            // Sócio
            if (dadosFiscais.qsa?.length > 0) {
                const socio = dadosFiscais.qsa.find(s =>
                    s.qualificacao_socio_administrador?.code == 49 ||
                    s.qualificacao_socio_administrador?.code == 65
                ) || dadosFiscais.qsa[0];
                if (socio) enrichment.dono = titleCase(socio.nome_socio || socio.nome);
            }

            console.log(`[ENRICH] ✅ ${lead.name} → ${enrichment.dono || 'sem sócio'} | ${enrichment.porte}`);
        }

    } catch (err) {
        console.error(`[ENRICH ERROR] ${lead.name}: ${err.message}`);
    }

    const finalScore = Math.min(Math.max((lead.quality_score || 50) + (enrichment.enriched ? 40 : 0), 0), 100);
    return { ...lead, ...enrichment, quality_score: finalScore };
}

module.exports = { enriquecerLeadIndividual };