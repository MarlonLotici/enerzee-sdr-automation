/**
 * 1_scraper.js - MÓDULO DE COLETA "DEEP DIVE" V5.1 (CORRIGIDO)
 * Correção: Permite carregamento de CSS para garantir que a lista apareça.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const SINONIMOS = {
    'padaria': ['panificadora', 'confeitaria', 'pães'],
    'mercado': ['supermercado', 'mercearia', 'mini mercado', 'atacarejo'],
    'farmacia': ['drogaria', 'farmácia'],
    'energia solar': ['instalação solar', 'energia fotovoltaica', 'painel solar', 'integrador solar'],
    'restaurante': ['churrascaria', 'pizzaria', 'bistro', 'sushi'],
    'oficina': ['mecânica', 'auto center', 'funilaria'],
    'clinica': ['consultório', 'odontologia', 'fisioterapia'],
    'loja': ['varejo', 'comércio', 'confecção']
};

async function humanScroll(page) {
    await page.evaluate(async () => {
        const wrapper = document.querySelector('div[role="feed"]');
        if (!wrapper) return;

        await new Promise((resolve) => {
            let totalHeight = 0;
            let distance = 400; // Scroll mais forte
            let attempts = 0;

            const timer = setInterval(() => {
                const scrollHeight = wrapper.scrollHeight;
                wrapper.scrollBy(0, distance);
                totalHeight += distance;

                // Se chegou no fim
                if (totalHeight >= scrollHeight) {
                    attempts++;
                    // Tenta forçar um pouco mais
                    if (attempts > 4) {
                        clearInterval(timer);
                        resolve();
                    }
                } else {
                    attempts = 0;
                }
                
                // Limite de segurança (aprox 100 leads)
                if (wrapper.childElementCount > 120) {
                    clearInterval(timer);
                    resolve();
                }
            }, 500); 
        });
    });
}

async function iniciarVarredura(params, onProgress) {
    const { city, niche, mode, lat, lng, radius } = params;
    const sendStatus = (msg) => onProgress({ type: 'status', message: msg });

    // Prepara termos
    let termos = [];
    const listaNichos = Array.isArray(niche) ? niche : [niche];
    listaNichos.forEach(n => {
        const chave = n.toLowerCase().trim();
        termos.push(chave);
        if (SINONIMOS[chave]) termos.push(...SINONIMOS[chave]);
    });
    termos = [...new Set(termos)];

    sendStatus(`🚀 [MOTOR V5.1] Iniciando. Modo: ${mode === 'map' ? 'GEO' : 'TEXTO'}`);

    const browser = await puppeteer.launch({
        headless: false, // Mantenha false para ver o que acontece!
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: null
    });

    const page = await browser.newPage();

    // --- CORREÇÃO: Bloqueio Suave (Permite CSS/Fontes para renderizar lista) ---
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        // Bloqueia apenas imagens pesadas e mídia, mas DEIXA fontes e estilos
        if (['image', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    try {
        for (const termo of termos) {
            let url = '';
            
            // Lógica de URL
            if (mode === 'map' && lat && lng) {
                // Zoom Ajustado (Menos zoom para pegar mais área)
                let zoom = 13; 
                if (radius <= 2) zoom = 14; 
                if (radius > 10) zoom = 12;
                
                url = `https://www.google.com.br/maps/search/${encodeURIComponent(termo)}/@${lat},${lng},${zoom}z`;
                sendStatus(`📡 Buscando "${termo}" (Raio ${radius}km)...`);
            } else {
                url = `https://www.google.com.br/maps/search/${encodeURIComponent(termo + ' em ' + city)}`;
                sendStatus(`🔎 Buscando "${termo}" em ${city}...`);
            }

            try {
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            } catch (e) {
                sendStatus(`⚠️ Timeout ao carregar página. Tentando ler mesmo assim...`);
            }

            // --- VERIFICAÇÃO CRÍTICA ---
            // Verifica se a lista apareceu
            try {
                await page.waitForSelector('div[role="feed"]', { timeout: 10000 });
            } catch (e) {
                // Se não achou a lista, vê se achou UM resultado único
                const unico = await page.$('h1.DUwDvf');
                if (unico) {
                    sendStatus(`⚠️ Resultado único encontrado (Google abriu direto).`);
                    // (Opcional: lógica para extrair único, mas vamos pular para manter fluxo)
                } else {
                    sendStatus(`⚠️ Google não mostrou lista para "${termo}". Tentando próximo...`);
                }
                continue;
            }

            sendStatus(`📜 Carregando lista...`);
            await humanScroll(page);

            // EXTRAÇÃO
            const leads = await page.evaluate((termoRef) => {
                const items = document.querySelectorAll('div[role="article"]');
                const results = [];

                items.forEach(item => {
                    const linkEl = item.querySelector('a[href*="/maps/place/"]');
                    if (!linkEl) return;

                    const text = item.innerText;
                    const lines = text.split('\n');
                    
                    let nome = linkEl.getAttribute('aria-label') || lines[0];
                    
                    // Regex Telefone
                    const telMatch = text.match(/(\(?\d{2}\)?\s?)?(9?\d{4}[-\s]?\d{4})/);
                    const telefone = telMatch ? telMatch[0] : "";

                    // Regex Nota
                    const ratingMatch = text.match(/([0-5],[0-9])\s?\(([\d\.]+)\)/);
                    const rating = ratingMatch ? ratingMatch[1] : "N/A";
                    const reviews = ratingMatch ? ratingMatch[2] : "0";

                    // Endereço (Pega a linha que contém vírgula e é longa)
                    const address = lines.find(l => l.includes(',') && l.length > 15) || "";

                    results.push({
                        name: nome,
                        niche: termoRef,
                        phone: telefone,
                        rating: rating,
                        reviews: reviews,
                        address: address,
                        link: linkEl.href,
                        source: 'Google Maps'
                    });
                });
                return results;
            }, termo);

            if (leads.length > 0) {
                sendStatus(`✨ ${leads.length} leads encontrados.`);
                for (const lead of leads) {
                    onProgress({ type: 'lead', data: lead });
                }
            } else {
                sendStatus(`⚠️ Lista carregou mas estava vazia para "${termo}".`);
            }
        }

    } catch (erro) {
        console.error("ERRO SCRAPER:", erro);
        sendStatus("❌ Erro no navegador.");
    } finally {
        await browser.close();
    }
}

module.exports = { iniciarVarredura };