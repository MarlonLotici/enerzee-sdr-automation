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
        await new Promise(r => setTimeout(r, 4000 + Math.random() * 3000));
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

            // --- NÚCLEO PROFISSIONAL DE BUSCA (SERPER.DEV) ---
        console.log(`[ENRICH] 🦅 Buscando no Google via API Serper: ${termoBusca}`);

        const bodyText = await new Promise((resolve) => {
            const postData = JSON.stringify({
                q: termoBusca,
                gl: "br", // Filtra resultados só do Brasil
                hl: "pt-br",
                num: 10 // Puxa 10 sites de uma vez para achar o CNPJ rápido
            });

            const options = {
                hostname: 'google.serper.dev',
                path: '/search',
                method: 'POST',
                headers: {
                    'X-API-KEY': process.env.SERPER_API_KEY,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 10000
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        let fullText = '';
                        // Junta título e resumo de todos os sites retornados
                        if (json.organic) {
                            json.organic.forEach(item => fullText += `${item.title} ${item.snippet} `);
                        }
                        // Pega dados da caixinha de empresa do Google (Knowledge Graph)
                        if (json.knowledgeGraph && json.knowledgeGraph.description) {
                            fullText += json.knowledgeGraph.description;
                        }
                        resolve(fullText);
                    } catch {
                        resolve('');
                    }
                });
            });

            req.on('error', () => resolve(''));
            req.on('timeout', () => { req.destroy(); resolve(''); });
            req.write(postData);
            req.end();
        });



            // 1. Extrai TODOS os CNPJs da página para evitar lixo de rodapé
        const todosCnpjs = [...new Set(bodyText.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) || [])];

        if (todosCnpjs.length === 0) {
            console.log(`[ENRICH] ❌ CNPJ não encontrado para ${lead.name}`);
            return { ...lead, ...enrichment };
        }

        let dadosFiscais = null;
        let cnpjValidado = null;
        const nomeMaps = lead.name.toUpperCase();

        // 2. Loop de Autenticação: Testa na Receita os 3 primeiros CNPJs achados
        for (const cnpj of todosCnpjs.slice(0, 3)) {
            const cnpjLimpo = cnpj.replace(/\D/g, '');
            const dados = await consultarDadosOficiais(cnpjLimpo);
            
            if (dados) {
                const razao = (dados.razao_social || "").toUpperCase();
                const fantasia = (dados.nome_fantasia || "").toUpperCase();
                
                const scoreRazao = stringSimilarity.compareTwoStrings(nomeMaps, razao);
                const scoreFantasia = stringSimilarity.compareTwoStrings(nomeMaps, fantasia);
                enrichment.match_confidence = Math.max(scoreRazao, scoreFantasia) * 100;

                const cidadeBate = dados.municipio && (lead.city || "").toLowerCase().includes(dados.municipio.toLowerCase());

                // 3. Match Confirmado!
                if (enrichment.match_confidence > 20 || cidadeBate) {
                    dadosFiscais = dados;
                    cnpjValidado = cnpj;
                    break; // Para o loop, achou o dono
                }
            }
        }

        if (!dadosFiscais) {
            console.log(`[ENRICH] ❌ Alucinação bloqueada. CNPJs não bateram com ${lead.name}`);
            return { ...lead, ...enrichment };
        }

        console.log(`[ENRICH] ✅ CNPJ Validado na Receita: ${cnpjValidado}`);

        if (true) { // Mantém a estrutura de chaves do seu código intacta
            enrichment.cnpj              = cnpjValidado;
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
    return { ...lead, ...enrichment, quality_score: finalScore, quality_score_int4: finalScore };
}

module.exports = { enriquecerLeadIndividual };