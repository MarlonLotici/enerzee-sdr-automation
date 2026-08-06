/**
 * 3_enrich.js - MÓDULO V11 (DATA PLUS)
 * Lógica V10 (DuckDuckGo Open) + Extração Avançada de Endereço e CNAEs.
 */


const https = require('https');
const http = require('http');
const stringSimilarity = require('string-similarity');

// Domínios de diretório/agregador e serviços — capturar email destes seria pegar o contato
// do site errado (não o da empresa-alvo). Também barra assets que casam com a regex de email.
const DOMINIOS_BLOQUEADOS = [
    'apontador', 'telelistas', 'econodata', 'guiamais', 'solutudo', 'hotfrog', 'cnpj.biz',
    'casadosdados', 'empresascnpj', 'consultacnpj', 'cnpja', 'receita', 'gov.br', 'google.',
    'facebook.', 'instagram.', 'wa.me', 'whatsapp', 'example.', 'sentry', 'wix', 'godaddy',
    'w3.org', 'schema.org', 'gstatic', 'googleapis', 'cloudflare', 'jsdelivr', 'gmpg.org',
    // plataformas de terceiros que aparecem no snippet mas NÃO são o email do negócio-alvo
    'ifood', 'grubbio', 'linktr', 'linktree', 'sfiec', 'sebrae', 'tripadvisor', 'yelp',
    'reclameaqui', 'trustpilot', 'ubereats', 'rappi', 'goomer', 'anota.ai', 'linkedin',
    'wordpress.com', 'blogspot', 'mercadolivre', 'olx', 'elfsight', 'squarespace',
];

// Extrai o 1º email plausível de um bloco de texto/HTML, descartando lixo, assets e diretórios.
function extrairEmailDeTexto(texto) {
    if (!texto) return null;
    const achados = String(texto).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    for (const bruto of achados) {
        const email = bruto.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        if (email.length > 80) continue;
        if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|ico|woff2?)$/i.test(email)) continue; // asset@2x.png etc
        const dominio = email.split('@')[1] || '';
        if (DOMINIOS_BLOQUEADOS.some(d => dominio.includes(d))) continue;
        return email;
    }
    return null;
}

// Baixa o HTML de uma URL com timeout curto e teto de tamanho. Falha silenciosa (retorna '').
// Segue até 2 redirects (http→https e apex↔www são a norma nos sites de PME; sem isso a
// fonte "site" quase nunca funciona — a maioria responde 301 na primeira URL).
function baixarHtml(url, saltos = 0) {
    return new Promise((resolve) => {
        if (saltos > 2) return resolve('');
        try {
            const u = new URL(url);
            const mod = u.protocol === 'http:' ? http : https;
            const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (SDR-Master-Bot)' }, timeout: 5000 }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.destroy();
                    const destino = new URL(res.headers.location, url).href; // resolve redirect relativo
                    return resolve(baixarHtml(destino, saltos + 1));
                }
                if (res.statusCode !== 200) { res.destroy(); return resolve(''); }
                let data = '';
                res.on('data', chunk => { data += chunk; if (data.length > 500000) { req.destroy(); } });
                res.on('end', () => resolve(data));
            });
            req.on('error', () => resolve(''));
            req.on('timeout', () => { req.destroy(); resolve(''); });
        } catch { resolve(''); }
    });
}

// Tenta achar um email no site do lead: home + páginas de contato comuns (muitos sites só
// expõem o email no /contato). Para na 1ª que achar. Só a minoria de PMEs tem site, mas quando
// tem é a melhor fonte. Custo: alguns GETs rápidos, sem API paga.
async function buscarEmailNoSite(website) {
    if (!website) return null;
    let base;
    try { base = new URL(website); } catch { return null; }
    // Só home + /contato (as 2 mais prováveis) — mais caminhos deixavam o enrich lento demais
    // (cada GET tem timeout de 5s; multiplicar por muitos caminhos × muitos sites não escala).
    const caminhos = ['', '/contato'];
    for (const caminho of caminhos) {
        const url = caminho ? new URL(caminho, base.origin).href : website;
        const html = await baixarHtml(url);
        const email = extrairEmailDeTexto(html);
        if (email) return email;
    }
    return null;
}



// POST genérico no Serper /search. Retorna o JSON parseado (ou null).
function consultarSerper(q) {
    return new Promise((resolve) => {
        const postData = JSON.stringify({ q, gl: 'br', hl: 'pt-br', num: 10 });
        const options = {
            hostname: 'google.serper.dev', path: '/search', method: 'POST',
            headers: {
                'X-API-KEY': process.env.SERPER_API_KEY,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 12000,
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.write(postData); req.end();
    });
}

// Normaliza um texto pra comparação: minúsculo, sem acento, só alfanumérico.
function _normalizar(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

// Um email é "confiável" pra este lead se o domínio do email lembra o nome do negócio OU o
// domínio do site que raspamos. Isso barra email de plataforma/terceiro que casa a regex mas
// não é da empresa-alvo (o usuário exigiu: só usar se for confiável).
function emailPareceConfiavel(email, nomeNegocio, dominioSite) {
    if (!email) return false;
    const dominio = (email.split('@')[1] || '').toLowerCase();
    const dominioBase = dominio.split('.')[0]; // ex: 'padariasaojose' de 'padariasaojose.com.br'
    if (!dominioBase || dominioBase.length < 3) return false;
    // Provedores genéricos (gmail/hotmail/etc): só confia se o LOCAL-part não for genérico demais.
    const genericos = ['gmail', 'hotmail', 'outlook', 'yahoo', 'bol', 'uol', 'live', 'icloud', 'terra', 'globomail'];
    const ehGenerico = genericos.includes(dominioBase);
    const nomeNorm = _normalizar(nomeNegocio);
    if (ehGenerico) {
        // gmail é comum em PME; aceita só se o nome do negócio aparecer no local-part (ex: padariasjose@gmail.com)
        const local = _normalizar(email.split('@')[0]);
        if (local.length < 4) return false;
        const sim = stringSimilarity.compareTwoStrings(local, nomeNorm);
        return sim > 0.45 || nomeNorm.includes(local) || local.includes(nomeNorm.slice(0, 8));
    }
    // Domínio próprio: casa com o site raspado (mesmo domínio) OU com o nome do negócio.
    if (dominioSite && dominio.includes(_normalizar(dominioSite).slice(0, 10))) return true;
    const simNome = stringSimilarity.compareTwoStrings(_normalizar(dominioBase), nomeNorm);
    return simNome > 0.35 || nomeNorm.includes(dominioBase) || dominioBase.includes(nomeNorm.slice(0, 6));
}

// EMAIL FINDER via Serper: 2ª busca focada em email (só quando a Receita não deu email).
// Fluxo: query "nome cidade email OR contato" → tenta email confiável nos snippets → senão,
// raspa os primeiros links que parecem do próprio negócio. Retorna { email, source } ou null.
// Reusa o crédito Serper que o usuário já paga; atrás do flag ENRICH_EMAIL_SERPER.
async function buscarEmailViaSerper(lead) {
    if (process.env.ENRICH_EMAIL_SERPER === '0') return null;
    if (!process.env.SERPER_API_KEY) return null;
    const nome = (lead.name || '').trim();
    if (!nome) return null;
    const loc = lead.city || lead.bairro || lead.estado || '';
    const j = await consultarSerper(`"${nome}" ${loc} email OR contato`);
    if (!j) return null;

    const organic = Array.isArray(j.organic) ? j.organic : [];
    // 1) Emails nos snippets, validados por confiança.
    let textoSnippets = '';
    organic.forEach(o => { textoSnippets += `${o.title || ''} ${o.snippet || ''} `; });
    const candidatosSnippet = (textoSnippets.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])
        .map(e => e.trim().toLowerCase());
    for (const email of candidatosSnippet) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        const dom = email.split('@')[1] || '';
        if (DOMINIOS_BLOQUEADOS.some(d => dom.includes(d))) continue;
        if (emailPareceConfiavel(email, nome, null)) return { email, source: 'serper' };
    }

    // 2) Raspa os primeiros links que parecem do próprio negócio (não-diretório).
    const linksNegocio = organic.map(o => o.link).filter(Boolean)
        .filter(l => !DOMINIOS_BLOQUEADOS.some(d => l.toLowerCase().includes(d)))
        .slice(0, 2);
    for (const link of linksNegocio) {
        const email = await buscarEmailNoSite(link);
        if (email && emailPareceConfiavel(email, nome, new URL(link).hostname)) {
            return { email, source: 'site' };
        }
    }
    return null;
}

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

// Normaliza um telefone cru da Receita para um celular BR de 13 dígitos (55+DDD+9+8), ou null se
// não for celular válido. Mesma lógica do bloco SNIPER, extraída pra reusar no ddd_telefone_2.
function _normalizarCelularReceita(bruto) {
    let tel = String(bruto || '').replace(/\D/g, '');
    if (!tel) return null;
    if (tel.length === 10 || tel.length === 11) tel = '55' + tel;
    else if (tel.length > 13 && tel.startsWith('5555')) tel = tel.substring(2);
    return (tel.length === 13 && tel[4] === '9') ? tel : null;
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
        email: null,
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
            enrichment.estado            = dadosFiscais.uf; // 🎯 GARANTIA DUPLA! Pega da Receita Federal.
            enrichment.enriched          = true;

            // 📧 Email cadastrado na Receita Federal — vem de graça na mesma chamada do
            // BrasilAPI, sem custo extra de API. Validação básica pra não gravar lixo/vazio.
            const emailReceita = (dadosFiscais.email || '').trim().toLowerCase();
            if (emailReceita && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailReceita)) {
                enrichment.email = emailReceita;
                console.log(`📧 [ENRICH] Email encontrado na Receita: ${emailReceita}`);
            }

            // 📧 Fallback multi-fonte (a Receita quase nunca tem email pra PME): tenta os snippets
            // do Google que já buscamos (bodyText, custo ZERO) e depois o site do lead (se existir).
            if (!enrichment.email) {
                const emailSnippet = extrairEmailDeTexto(bodyText);
                if (emailSnippet && emailPareceConfiavel(emailSnippet, lead.name, null)) {
                    enrichment.email = emailSnippet;
                    enrichment.email_source = 'serper';
                    console.log(`📧 [ENRICH] Email confiável nos snippets do Google: ${emailSnippet}`);
                } else if (lead.website) {
                    const emailSite = await buscarEmailNoSite(lead.website);
                    if (emailSite) {
                        enrichment.email = emailSite;
                        enrichment.email_source = 'site';
                        console.log(`📧 [ENRICH] Email achado no site (${lead.website}): ${emailSite}`);
                    }
                }
            } else {
                enrichment.email_source = 'receita';
            }

            // 🔎 EMAIL FINDER (Serper): última cartada quando ainda não achamos email — 2ª busca
            // focada em email + raspagem dos links do negócio, com validação de confiança.
            if (!enrichment.email) {
                const achado = await buscarEmailViaSerper(lead);
                if (achado) {
                    enrichment.email = achado.email;
                    enrichment.email_source = achado.source;
                    console.log(`📧 [ENRICH] Email achado via finder (${achado.source}): ${achado.email}`);
                }
            }


            // Sócio
            if (dadosFiscais.qsa?.length > 0) {
                const socio = dadosFiscais.qsa.find(s =>
                    s.qualificacao_socio_administrador?.code == 49 ||
                    s.qualificacao_socio_administrador?.code == 65
                ) || dadosFiscais.qsa[0];
                if (socio) enrichment.dono = titleCase(socio.nome_socio || socio.nome);
            }

            // 👇 O SEQUESTRO DE TELEFONE E A GAVETA RESERVA 👇
            if (dadosFiscais.ddd_telefone_1) {
                let telReceita = dadosFiscais.ddd_telefone_1.replace(/\D/g, '');

                if (telReceita.length === 10 || telReceita.length === 11) {
                    telReceita = '55' + telReceita;
                } else if (telReceita.length > 13 && telReceita.startsWith('5555')) {
                    telReceita = telReceita.substring(2);
                }

                // Verifica se é celular válido (13 dígitos, começa com 9 após o DDD)
                if (telReceita.length === 13 && telReceita[4] === '9') {
                    const zapReceitaId = `${telReceita}@s.whatsapp.net`;
                    const visualReceita = `+55 (${telReceita.substring(2,4)}) ${telReceita.substring(4,9)}-${telReceita.substring(9)}`;

                    // 🔄 O TOMBAMENTO: Salva o telefone do Maps na gaveta reserva
                    enrichment.backup_phone = lead.phone;
                    enrichment.backup_whatsapp_id = lead.whatsappId || lead.whatsapp_id || `${lead.phone.replace(/\D/g, '')}@s.whatsapp.net`;
                    enrichment.backup_tried = false;

                    // O celular do dono assume a cadeira do capitão
                    lead.phone = visualReceita;
                    lead.whatsappId = zapReceitaId;
                    lead.whatsapp_id = zapReceitaId; // Garantia de nomenclatura
                    lead.type = 'mobile';

                    console.log(`🎯 [SNIPER] Celular do Sócio (${visualReceita}) assumiu a prioridade. Maps foi pra reserva.`);
                } else {
                    // tel1 é fixo/inválido. Antes de desistir, tenta o ddd_telefone_2 (2º telefone
                    // da Receita, que antes era ignorado): se ELE for celular válido, vira a reserva
                    // ÚTIL (backup_tried=false → o motor vai tentar). Senão, guarda o fixo como antes.
                    const tel2Mobile = _normalizarCelularReceita(dadosFiscais.ddd_telefone_2);
                    if (tel2Mobile) {
                        enrichment.backup_phone = `+55 (${tel2Mobile.substring(2,4)}) ${tel2Mobile.substring(4,9)}-${tel2Mobile.substring(9)}`;
                        enrichment.backup_whatsapp_id = `${tel2Mobile}@s.whatsapp.net`;
                        enrichment.backup_tried = false;
                        console.log(`📞 [SNIPER] tel1 fixo, mas ddd_telefone_2 é celular — virou reserva útil.`);
                    } else {
                        // Se for fixo ou inválido, joga na reserva mas marca como tentado pra IA não perder tempo com ele depois
                        enrichment.backup_phone = telReceita;
                        enrichment.backup_tried = true;
                    }
                }
            }

            console.log(`[ENRICH] ✅ ${lead.name} → ${enrichment.dono || 'sem sócio'} | ${enrichment.porte}`);
        }

    } catch (err) {
        console.error(`[ENRICH ERROR] ${lead.name}: ${err.message}`);
    }

    const finalScore = Math.min(Math.max((lead.quality_score || 50) + (enrichment.enriched ? 40 : 0), 0), 100);
    return { ...lead, ...enrichment, quality_score: finalScore, quality_score_int4: finalScore };
}

module.exports = { enriquecerLeadIndividual, consultarDadosOficiais, buscarEmailViaSerper, emailPareceConfiavel, _normalizarCelularReceita };