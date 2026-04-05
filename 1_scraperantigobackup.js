const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const https = require('https');

puppeteer.use(StealthPlugin());

const SINONIMOS = {
    'padaria': ['panificadora', 'confeitaria', 'fabricação de pães', 'padaria artesanal', 'casa de pães', 'indústria de pães', 'confeitaria fina', 'fábrica de bolos'],
    'mercado': ['supermercado', 'mercearia', 'mini mercado', 'atacarejo', 'hortifruti', 'empório', 'quitanda', 'açougue'],
    'restaurante': ['churrascaria', 'pizzaria', 'bistro', 'marmitaria', 'self service', 'hamburgueria', 'sushi bar'],
    'oficina': ['mecânica', 'auto center', 'funilaria', 'pintura automotiva', 'centro automotivo', 'auto elétrica'],
    'posto': ['posto de combustível', 'abastecimento', 'loja de conveniência', 'posto de gasolina'],
    'clinica': ['consultório', 'odontologia', 'dentista', 'estética', 'clínica médica', 'laboratório'],
    'farmacia': ['drogaria', 'farmácia de manipulação', 'farmácia popular'],
    'energia solar': ['instalação solar', 'energia fotovoltaica', 'painel solar', 'integrador solar'],
    'escola': ['colégio', 'educação infantil', 'ensino médio', 'escola de idiomas', 'creche']
};

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function buscarBairrosReais(cidade) {
    console.log(`🧠 [MAPPING] Acionando a IA (Groq Nativo) para extrair as veias de ouro de ${cidade}...`);
    
    try {
        const prompt = `Liste os 25 principais bairros residenciais e comerciais (onde ficam padarias e mercados) da cidade de ${cidade}, Brasil. Retorne APENAS um array JSON válido, sem formatação markdown, sem introdução. Exemplo: ["Centro", "Bosque da Saúde", "CPA I"]`;

        // 🚀 O Segredo: Fetch Nativo! Não usa bibliotecas que dão erro de conexão na Railway.
        // Bate direto no servidor de ultra-velocidade do Groq.
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1
            })
        });

        if (!res.ok) throw new Error(`Erro HTTP: ${res.status}`);

        const data = await res.json();
        const rawText = data.choices[0].message.content.trim();
        
        // Blindagem contra formatação indesejada da IA
        const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        let bairrosList = JSON.parse(cleanJson);

        if (!Array.isArray(bairrosList) || bairrosList.length === 0) {
            throw new Error("O JSON retornado estava vazio.");
        }

        console.log(`✅ [MAPPING] SUCESSO! A IA mapeou ${bairrosList.length} bairros cirúrgicos de ${cidade}!`);
        
        // Remove limites, ordena e devolve pronto pro motor térmico
        return bairrosList.sort().map(b => `${b}, ${cidade}`);

    } catch (err) {
        console.log(`⚠️ [IA] Falha na rede (${err.message}). Acionando Fallback de Ouro.`);
        
        // 🛡️ O FALLBACK DE OURO: Se a IA falhar de novo, ele JÁ SABE os bairros de Cuiabá de cor!
        if (cidade.toLowerCase().includes('cuiab')) {
            const bairrosCuiaba = [
                "Bosque da Saúde", "CPA I", "CPA II", "Pedra 90", "Jardim Imperial", 
                "Jardim das Américas", "Santa Rosa", "Goiabeiras", "Boa Esperança", 
                "Coxipó", "Tijucal", "Morada do Ouro", "Centro", "Areão", "Quilombo"
            ];
            console.log(`✅ [FALLBACK] Carregando ${bairrosCuiaba.length} veias de ouro locais de Cuiabá.`);
            return bairrosCuiaba.sort().map(b => `${b}, ${cidade}`);
        }
        
        // Se for outra cidade e tudo der errado, ele usa o fatiador padrão
        const fallback = ['Centro', 'Zona Norte', 'Zona Sul', 'Zona Leste', 'Zona Oeste', 
                   'Distrito Industrial', 'Bairro Comercial', 'Vila Nova', 'Jardim América'];
        return fallback.map(z => `${z}, ${cidade}`);
    }
}

async function humanScroll(page) {
    console.log("🖱️ [SCROLL] Varredura profunda iniciada...");
    await page.evaluate(async () => {
        const wrapper = document.querySelector('div[role="feed"]');
        if (!wrapper) return;
        await new Promise((resolve) => {
            let lastHeight = 0;
            let tentativas = 0;
            let totalScrolls = 0;
            const maxScrolls = 80;  // Máximo de scrolls (antes era ilimitado mas parava em 120 elementos)
            
            const timer = setInterval(() => {
                // Scroll variado pra parecer humano
                const scrollAmount = 400 + Math.floor(Math.random() * 400);
                wrapper.scrollBy(0, scrollAmount);
                totalScrolls++;
                
                if (wrapper.scrollHeight === lastHeight) {
                    tentativas++;
                } else {
                    tentativas = 0;
                }
                lastHeight = wrapper.scrollHeight;
                
                // Para quando: 12 tentativas sem mudança OU atingiu máximo de scrolls
                // Removido o limite de childElementCount — deixa scrollar até o fim
                if (tentativas >= 12 || totalScrolls >= maxScrolls) {
                    clearInterval(timer);
                    resolve();
                }
            }, 600 + Math.floor(Math.random() * 600)); // Intervalo variado: 600-1200ms
        });
    });
    
    // Conta quantos resultados foram carregados
    const totalResults = await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (!feed) return 0;
        return feed.querySelectorAll('a[href*="/maps/place/"]').length;
    });
    console.log(`📊 [SCROLL] ${totalResults} resultados carregados no feed`);
}

async function iniciarVarredura(params, onProgress, shouldStop = () => false) {
    const { city, niche, mode } = params;
    const sendStatus = (msg) => onProgress({ type: 'status', message: msg });

    // Cache global de deduplicação (persiste entre bairros e termos)
    const telefonesVistos = new Set();
    const linksVistos = new Set();
    let totalExtraidos = 0;
    let totalDuplicados = 0;
    let totalSemTelefone = 0;

    let termos = [];

    const listaNichos = Array.isArray(niche) ? niche : [niche || "Comércio"];
       listaNichos.forEach(n => {
    let val = (typeof n === 'object' && n.keywords) ? n.keywords : n;
    if (typeof val === 'string') {
        const chave = val.toLowerCase().trim();
        termos.push(chave);
        // Máximo 2 sinônimos por nicho (os mais relevantes ficam primeiro no array)
        if (SINONIMOS[chave]) termos.push(...SINONIMOS[chave].slice(0, 2));
    }
});
termos = [...new Set(termos)];
console.log(`🎯 [TERMOS] ${termos.length} termos de busca: ${termos.join(', ')}`);
    try {
        // 1. Pega TODOS os bairros
        let zonas = (mode !== 'map') ? await buscarBairrosReais(city) : [city];
        
        // 2. Fatiador de Lotes (Chunks de 5 bairros)
        const tamanhoLote = 5;
        const lotes = [];
        for (let i = 0; i < zonas.length; i += tamanhoLote) {
            lotes.push(zonas.slice(i, i + tamanhoLote));
        }

        console.log(`🔥 [MOTOR] Cidade dividida em ${lotes.length} lotes térmicos para não sobrecarregar a RAM.`);

        // 3. Loop dos Lotes (O Reinício Térmico)
        for (let loteIndex = 0; loteIndex < lotes.length; loteIndex++) {
            if (shouldStop()) break;
            
            const loteAtual = lotes[loteIndex];
            console.log(`\n🔄 [REINÍCIO TÉRMICO] Iniciando Lote ${loteIndex + 1}/${lotes.length}. RAM zerada!`);

            // Inicia o navegador FRESCO para este lote
            const browser = await puppeteer.launch({
                headless: "new",
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
                args: [
                    '--start-maximized', 
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ]
            });

            try {
                for (const zona of loteAtual) {
                    if (shouldStop()) break;
                    
                    for (const termo of termos) {
                        if (shouldStop()) break;

                        const query = `${termo}${zona.includes('📍') ? "" : ` em ${zona}`}`;
                        console.log(`📡 [RADAR] Alvo: ${query}`);
                        
                        const page = await browser.newPage();
                        await page.setViewport({ width: 1280, height: 900 });

                        await page.goto(`https://www.google.com.br/maps/search/${encodeURIComponent(query)}?hl=pt-BR`, { waitUntil: 'domcontentloaded', timeout: 60000 });                
                        try {
                            await page.waitForSelector('div[role="feed"]', { timeout: 20000 });
                            await humanScroll(page);
                        } catch (e) { 
                            await page.close();
                            continue; 
                        }

                        const linksLeads = await page.evaluate(() => {
                            return Array.from(document.querySelectorAll('a[href*="/maps/place/"]')).map(a => a.href);
                        });

                        console.log(`🕵️ [DEBUG] ${linksLeads.length} potenciais em ${zona}. Extraindo...`);


                        // Filtra links já visitados nesta sessão
const linksNovos = linksLeads.filter(link => {
    if (linksVistos.has(link)) return false;
    linksVistos.add(link);
    return true;
});

console.log(`🔗 [DEDUP] ${linksLeads.length} links encontrados, ${linksNovos.length} novos (${linksLeads.length - linksNovos.length} já visitados)`);

for (let i = 0; i < linksNovos.length; i++) {
    if (shouldStop()) break;
    try {
        await page.goto(linksNovos[i], { waitUntil: 'domcontentloaded', timeout: 35000 });
        await delay(1000 + Math.floor(Math.random() * 1000)); // 1-2s variado

        const leadInfo = await page.evaluate((urlLead, termoRef, cidadeRef, zonaRef) => {
            const nome = document.querySelector('h1')?.innerText || "";
            
            const lixo = ["prefeitura", "município", "resultados", "filtros", "ordenar", 
                          "google", "mais", "câmara", "secretaria", "tribunal", "fórum",
                          "delegacia", "bombeiros", "samu", "ibge"];
            if (!nome || nome.length < 3 || lixo.some(word => nome.toLowerCase().includes(word))) return null;

            // === TELEFONE: tenta botão específico primeiro, depois corpo ===
            let telefone = null;
            
            // Método 1: Botão de telefone do Google Maps (mais confiável)
            const btnTel = document.querySelector('button[data-item-id="phone:tel"]') 
                        || document.querySelector('button[data-item-id*="phone"]')
                        || document.querySelector('a[data-item-id*="phone"]');
            if (btnTel) {
                const telText = btnTel.innerText || btnTel.getAttribute('aria-label') || '';
                const matchBtn = telText.match(/(\(?\d{2}\)?\s?)(9?\d{4}[-\s]?\d{4})/);
                if (matchBtn) telefone = matchBtn[0];
            }
            
            // Método 2: Fallback no corpo da página
            if (!telefone) {
                const corpo = document.body.innerText;
                const matchCorpo = corpo.match(/(\(?\d{2}\)?\s?)(9?\d{4}[-\s]?\d{4})/);
                if (matchCorpo) telefone = matchCorpo[0];
            }
            
            if (!telefone) return null;

            // === ENDEREÇO ===
            let endereco = "Não identificado";
            const btnEnd = document.querySelector('button[data-item-id="address"]');
            if (btnEnd) endereco = btnEnd.innerText;

            // === RATING E REVIEWS ===
            let rating = null;
            let reviews = 0;
            
            // Tenta pegar o rating do span principal
            const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]')
                          || document.querySelector('span.ceNzKf');
            if (ratingEl) {
                const rVal = parseFloat(ratingEl.innerText.replace(',', '.'));
                if (!isNaN(rVal) && rVal > 0 && rVal <= 5) rating = rVal;
            }
            
            // Tenta pegar quantidade de reviews
            const reviewEl = document.querySelector('span[aria-label*="comentário"]')
                          || document.querySelector('span[aria-label*="review"]')
                          || document.querySelector('span[aria-label*="avalia"]');
            if (reviewEl) {
                const rMatch = reviewEl.getAttribute('aria-label').match(/(\d[\d.]*)/);
                if (rMatch) reviews = parseInt(rMatch[1].replace('.', ''));
            }

            // === HORÁRIO DE FUNCIONAMENTO ===
            let horario = null;
            const btnHorario = document.querySelector('button[data-item-id*="hour"]')
                            || document.querySelector('div[aria-label*="horário"]');
            if (btnHorario) {
                const hText = btnHorario.innerText || btnHorario.getAttribute('aria-label') || '';
                if (hText.length < 100) horario = hText.split('\n')[0];
            }

            // === CATEGORIA/TIPO ===
            let categoria = null;
            const catEl = document.querySelector('button[jsaction*="category"]')
                       || document.querySelector('.DkEaL');
            if (catEl) categoria = catEl.innerText;

            // === WEBSITE ===
            let website = null;
            const btnSite = document.querySelector('a[data-item-id="authority"]');
            if (btnSite) website = btnSite.href;
            
            // === COORDENADAS ===
            const coordMatch = urlLead.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);

            return {
                name: nome,
                niche: termoRef,
                phone: telefone,
                address: endereco,
                city: cidadeRef,
                bairro: zonaRef.split(',')[0],
                link: urlLead,
                lat: coordMatch ? parseFloat(coordMatch[1]) : null,
                lng: coordMatch ? parseFloat(coordMatch[2]) : null,
                rating: rating,
                reviews: reviews,
                horario: horario,
                categoria: categoria,
                website: website,
                valido: true
            };

        }, linksNovos[i], termo, city, zona);

        if (!leadInfo) {
            totalSemTelefone++;
            continue;
        }

        // === DEDUPLICAÇÃO POR TELEFONE (normalizado) ===
        const telNormalizado = leadInfo.phone.replace(/\D/g, '').slice(-11); // Últimos 11 dígitos
        
        if (telefonesVistos.has(telNormalizado)) {
            totalDuplicados++;
            console.log(`🔄 [DEDUP] ${leadInfo.name} já existe (tel: ${telNormalizado}). Pulando.`);
            continue;
        }
        
        telefonesVistos.add(telNormalizado);
        totalExtraidos++;
        
        console.log(`✅ [EXTRAÍDO #${totalExtraidos}] ${leadInfo.name} | ${leadInfo.phone} | ⭐${leadInfo.rating || '?'} (${leadInfo.reviews} reviews)`);
        await onProgress({ type: 'lead', data: leadInfo });
        
    } catch (e) {
        console.log(`⚠️ Falha no lead ${i + 1}/${linksNovos.length}. Pulando...`);
    }
}
                        console.log(`📊 [ZONA] ${zona} | ${termo} | Extraídos: ${totalExtraidos} | Duplicados: ${totalDuplicados} | Sem tel: ${totalSemTelefone}`);

                        await page.close(); // Fecha a aba após terminar aquele bairro e termo
                    }
                }
            } finally {
                await browser.close(); // MATA O NAVEGADOR E LIMPA A RAM
                await delay(3000); // Dá 3 segundos pro servidor respirar antes do próximo lote
            }
        }
    } catch (err) {
        console.error("🔥 ERRO NO MOTOR:", err);
    } finally {
        sendStatus("🏁 Varredura 100% da cidade finalizada com segurança.");
    }
}

module.exports = { iniciarVarredura };