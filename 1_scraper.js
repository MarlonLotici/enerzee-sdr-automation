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
    console.log(`🗺️ [MAPPING] Iniciando triangulação geográfica para: ${cidade}...`);
    const fetchOSM = (query) => new Promise((resolve) => {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&country=Brazil&format=json&addressdetails=1&limit=45`;
        const req = https.get(url, { headers: { 'User-Agent': `EnerzeeBot-V20-${Math.random()}` } }, (res) => {
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
        console.log(`⚠️ [OSM] API limitada. Usando Morfologia Brasileira.`);
        return [`Centro`, `Jardim`, `Vila`, `Parque`, `Distrito Industrial`].map(z => `${z}, ${cidade}`);
    }
    console.log(`✅ [MAPPING] ${bairrosSet.size} bairros detectados.`);
    return Array.from(bairrosSet).slice(0, 15).map(b => `${b}, ${cidade}`);
}

async function humanScroll(page) {
    console.log("🖱️ [SCROLL] Varredura profunda iniciada (Alvo: 500 leads)...");
    await page.evaluate(async () => {
        const wrapper = document.querySelector('div[role="feed"]');
        if (!wrapper) return;
        await new Promise((resolve) => {
            let lastHeight = 0;
            let tentativas = 0;
            const timer = setInterval(() => {
                wrapper.scrollBy(0, 600);
                if (wrapper.scrollHeight === lastHeight) tentativas++;
                else tentativas = 0;
                lastHeight = wrapper.scrollHeight;
                // Busca até 500 itens para garantir Diadema inteira
                if (tentativas >= 12 || wrapper.childElementCount > 500) {
                    clearInterval(timer);
                    resolve();
                }
            }, 850);
        });
    });
}

async function iniciarVarredura(params, onProgress) {
    const { city, niche, mode } = params;
    const sendStatus = (msg) => onProgress({ type: 'status', message: msg });

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

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--start-maximized', '--no-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    
    try {
        let zonas = (mode !== 'map') ? await buscarBairrosReais(city) : [city];
        
        for (const zona of zonas) {
            for (const termo of termos) {
                const query = `${termo}${zona.includes('📍') ? "" : ` em ${zona}`}`;
                console.log(`📡 [RADAR] Alvo: ${query}`);
                
                await page.goto(`https://www.google.com.br/maps/search/${encodeURIComponent(query)}?hl=pt-BR`, { waitUntil: 'networkidle2', timeout: 60000 });                
                try {
                    await page.waitForSelector('div[role="feed"]', { timeout: 10000 });
                    await humanScroll(page);
                } catch (e) { continue; }

                const linksLeads = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('a[href*="/maps/place/"]')).map(a => a.href);
                });

                console.log(`🕵️ [DEBUG] ${linksLeads.length} potenciais em ${zona}. Iniciando extração estável...`);

                let lastSavedName = "";

                for (let i = 0; i < linksLeads.length; i++) {
                    try {
                        // 🚀 EVOLUÇÃO: Navega direto para o link. Zero falhas de clique.
                        await page.goto(linksLeads[i], { waitUntil: 'networkidle2', timeout: 60000 });
                        await delay(2000); 

                        const leadInfo = await page.evaluate((urlLead, termoRef, cidadeRef, zonaRef) => {
                            const nome = document.querySelector('h1')?.innerText || "";
                            
                            // 🛡️ FILTRO ANTI-LIXO: Ignora Prefeituras, Municípios e botões
                            const lixo = ["prefeitura", "município", "resultados", "filtros", "ordenar", "google", "mais"];
                            if (!nome || nome.length < 3 || lixo.some(word => nome.toLowerCase().includes(word))) return null;

                            const corpo = document.body.innerText;
                            const matchTel = corpo.match(/(\(?\d{2}\)?\s?)?(9?\d{4}[-\s]?\d{4})/);
                            if (!matchTel) return null; // Ignora se não tiver telefone

                            let endereco = "Não identificado";
                            const btnEnd = document.querySelector('button[data-item-id="address"]');
                            if (btnEnd) endereco = btnEnd.innerText;
                            // Extrai lat/lng direto da URL — formato /@lat,lng,zoom
const coordMatch = urlLead.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);

return {
    name: nome,
    niche: termoRef,
    phone: matchTel[0],
    address: endereco,
    city: cidadeRef,
    bairro: zonaRef.split(',')[0],
    link: urlLead,
    lat: coordMatch ? parseFloat(coordMatch[1]) : null,
    lng: coordMatch ? parseFloat(coordMatch[2]) : null,
    valido: true
};

                        }, linksLeads[i], termo, city, zona);

                        // 🛡️ ANTI-REPETIÇÃO: Só salva se o nome for diferente do anterior
                        if (leadInfo && leadInfo.name !== lastSavedName) {
                            lastSavedName = leadInfo.name;
                            console.log(`✅ [EXTRAÍDO] ${leadInfo.name} | ${leadInfo.phone}`);
                            await onProgress({ type: 'lead', data: leadInfo });
                        }

                    } catch (e) {
                        console.log(`⚠️ Falha no lead ${i + 1}. Pulando...`);
                    }
                }
            }
        }
    } catch (err) {
        console.error("🔥 ERRO NO MOTOR:", err);
    } finally {
        await browser.close();
        sendStatus("🏁 Varredura finalizada.");
    }
}

module.exports = { iniciarVarredura };