const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const https = require('https');

puppeteer.use(StealthPlugin());

const SINONIMOS = {
    'padaria': ['panificadora', 'confeitaria', 'fabricação de pães', 'padaria artesanal', 'casa de pães', 'indústria de pães', 'confeitaria fina', 'fábrica de bolos'],
    'mercado': ['supermercado', 'mercearia', 'mini mercado', 'atacarejo', 'hortifruti', 'empório', 'quitanda'],
    'restaurante': ['churrascaria', 'pizzaria', 'bistro', 'marmitaria', 'self service', 'hamburgueria', 'sushi bar'],
    'oficina': ['mecânica', 'auto center', 'funilaria', 'pintura automotiva', 'centro automotivo', 'auto elétrica'],
    'posto': ['posto de combustível', 'abastecimento', 'loja de conveniência', 'posto de gasolina'],
    'clinica': ['consultório', 'odontologia', 'dentista', 'estética', 'clínica médica', 'laboratório'],
    'farmacia': ['drogaria', 'farmácia de manipulação', 'farmácia popular'],
    'energia solar': ['instalação solar', 'energia fotovoltaica', 'painel solar', 'integrador solar'],
    'escola': ['colégio', 'educação infantil', 'ensino médio', 'escola de idiomas', 'creche']
};

// --- MOTOR DE GEOGRAFIA ---
const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function buscarBairrosReais(cidade) {
    console.log(`🗺️ [MAPPING] Iniciando triangulação geográfica para: ${cidade}...`);
    const fetchOSM = (query) => new Promise((resolve) => {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&country=Brazil&format=json&addressdetails=1&limit=45`;
        const req = https.get(url, { headers: { 'User-Agent': `EnerzeeBot-Debug-${Math.random()}` } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { const parsed = JSON.parse(data); resolve(Array.isArray(parsed) ? parsed : []); } catch { resolve([]); } });
        });
        req.on('error', () => resolve([]));
    });

    let bairrosSet = new Set();
    const res1 = await fetchOSM(`bairros em ${cidade}`);
    res1.forEach(item => { const b = item.address?.suburb || item.address?.neighbourhood; if (b) bairrosSet.add(b); });

    if (bairrosSet.size === 0) {
        console.log(`⚠️ [OSM] API bloqueada. Usando Morfologia Brasileira para ${cidade}.`);
        return [`Centro`, `Jardim`, `Vila`, `Parque`, `Distrito Industrial`].map(z => `${z}, ${cidade}`);
    }
    console.log(`✅ [MAPPING] ${bairrosSet.size} bairros detectados.`);
    return Array.from(bairrosSet).slice(0, 15).map(b => `${b}, ${cidade}`);
}

// --- SCROLL PROFUNDO (DEEP SCAN) ---
async function humanScroll(page) {
    console.log("🖱️ [SCROLL] Iniciando varredura profunda da lista...");
    await page.evaluate(async () => {
        const wrapper = document.querySelector('div[role="feed"]');
        if (!wrapper) return;
        await new Promise((resolve) => {
            let lastHeight = 0;
            let tentativas = 0;
            const timer = setInterval(() => {
                wrapper.scrollBy(0, 400);
                console.log(`📜 [BROWSER] Itens no Feed: ${wrapper.childElementCount}`);
                if (wrapper.scrollHeight === lastHeight) {
                    tentativas++;
                } else {
                    tentativas = 0;
                }
                lastHeight = wrapper.scrollHeight;
                // Busca até 150 itens ou até o Google parar de entregar
                if (tentativas >= 10 || wrapper.childElementCount > 150) {
                    clearInterval(timer);
                    resolve();
                }
            }, 900);
        });
    });
}

// --- CORE DO SCRAPER (CLICK & COLLECT V2026) ---
async function iniciarVarredura(params, onProgress) {
    const { city, niche, mode, lat, lng } = params;
    const sendStatus = (msg) => onProgress({ type: 'status', message: msg });

    console.log("🔧 [DEBUG] Analisando termos de busca...");
    let termos = [];
    const listaNichos = Array.isArray(niche) ? niche : [niche || "Comércio"];
    listaNichos.forEach(n => {
        let val = (typeof n === 'object' && n.keywords) ? n.keywords : n;
        if (typeof val === 'string') {
            const chave = val.toLowerCase().trim();
            termos.push(chave);
            if (SINONIMOS[chave]) termos.push(...SINONIMOS[chave]);
        }
    });
    termos = [...new Set(termos)];
    console.log(`🔎 [RADAR] Termos Ativos: [${termos.join(', ')}]`);

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--start-maximized', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    page.on('console', msg => { if (msg.text().includes('[BROWSER]')) console.log(msg.text()); });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    try {
        let zonas = (mode !== 'map') ? await buscarBairrosReais(city) : [city];
        console.log(`📍 [SCRAPER] Atacando ${zonas.length} zonas geográficas.`);

        for (const zona of zonas) {
            for (const termo of termos) {
                // Passo 1: Limpeza da localização e construção da URL inteligente
                const localLimpo = zona.includes('📍') ? "" : ` em ${zona}`;
                const query = `${termo}${localLimpo}`;
                
                let url = '';
                if (mode === 'map' && lat && lng) {
                    // Se for clique no mapa, usa as coordenadas reais para evitar o DDD 48
                    url = `https://www.google.com.br/maps/search/${encodeURIComponent(termo)}/@${lat},${lng},14z?hl=pt-BR`;
                } else {
                    // Se for busca por cidade/bairro, usa o formato padrão
                    url = `https://www.google.com.br/maps/search/${encodeURIComponent(query)}?hl=pt-BR`;
                }
                
                console.log(`📡 [RADAR] Alvo: ${query}`);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
                
                try {
                    await page.waitForSelector('div[role="feed"]', { timeout: 10000 });
                    await humanScroll(page);
                } catch (e) {
                    console.log("⏭️ [DEBUG] Zona sem resultados ou falha no carregamento.");
                    continue;
                }

                // --- CAPTURA DE LINKS ---
                const linksLeads = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('a[href*="/maps/place/"]'))
                        .map(a => a.href)
                        .filter((v, i, a) => a.indexOf(v) === i); // Únicos
                });

                console.log(`🕵️ [DEBUG] ${linksLeads.length} leads potenciais na lista. Iniciando extração detalhada...`);

                for (let i = 0; i < linksLeads.length; i++) {
                    try {
                        console.log(`👉 [DETALHE] Abrindo lead ${i + 1}/${linksLeads.length}...`);
                        
                        // Clica no link para abrir o painel lateral
                        const linkSelector = `a[href="${linksLeads[i]}"]`;
                        await page.click(linkSelector);
                        await delay(2000); // Espera o painel lateral carregar dados reais

                        const leadInfo = await page.evaluate((urlLead, termoRef, cidadeRef, zonaRef) => {
                            // SELETORES DE PAINEL LATERAL 2026
                            const nome = document.querySelector('h1')?.innerText || "Sem Nome";
                            const painelTexto = document.body.innerText;
                            
                            // Regex de Telefone (Foca no painel lateral onde o dado está completo)
                            const matchTel = painelTexto.match(/(\(?\d{2}\)?\s?)?(9?\d{4}[-\s]?\d{4})/);
                            
                            if (!matchTel) return null; // Ignora se não tiver telefone mesmo no detalhe

                            // Endereço (Busca o ícone de localização para pegar o texto vizinho)
                            let endereco = "Endereço não identificado";
                            const btnEndereco = document.querySelector('button[data-item-id="address"]');
                            if (btnEndereco) endereco = btnEndereco.innerText;

                            return {
                                name: nome,
                                niche: termoRef,
                                phone: matchTel[0],
                                address: endereco,
                                city: cidadeRef,
                                bairro: zonaRef.split(',')[0],
                                link: urlLead,
                                valido: true
                            };
                        }, linksLeads[i], termo, city, zona);

                        if (leadInfo) {
                            console.log(`✅ [EXTRAÍDO] ${leadInfo.name} | ${leadInfo.phone}`);
                            await onProgress({ type: 'lead', data: leadInfo });
                        } else {
                            console.log(`❌ [IGNORADO] Sem telefone no painel lateral.`);
                        }

                        // Proteção para não ser bloqueado (Simula leitura humana)
                        if (i % 5 === 0) await delay(1000);

                    } catch (e) {
                        console.log(`⚠️ Erro ao processar lead ${i + 1}. Pulando...`);
                    }
                }
            }
        }
    } catch (err) {
        console.error("🔥 ERRO CRÍTICO NO MOTOR:", err);
    } finally {
        await browser.close();
        sendStatus("🏁 Varredura finalizada.");
    }
}

module.exports = { iniciarVarredura };