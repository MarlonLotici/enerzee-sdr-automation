const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const SINONIMOS = {
    'padaria': ['panificadora', 'confeitaria'],
    'mercado': ['supermercado', 'mercearia', 'mini mercado', 'atacarejo'],
    'energia solar': ['instalação solar', 'energia fotovoltaica'],
    'restaurante': ['churrascaria', 'pizzaria', 'bistro'],
    'oficina': ['mecânica', 'auto center'],
    'clinica': ['consultório', 'odontologia'],
    'hotel': ['pousada', 'hostel', 'resort', 'motel']
};

async function humanScroll(page) {
    await page.evaluate(async () => {
        const wrapper = document.querySelector('div[role="feed"]');
        if (!wrapper) return;
        await new Promise((resolve) => {
            let totalHeight = 0;
            let distance = 400;
            const timer = setInterval(() => {
                const scrollHeight = wrapper.scrollHeight;
                wrapper.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight || wrapper.childElementCount > 80) {
                    clearInterval(timer);
                    resolve();
                }
            }, 800);
        });
    });
}

async function iniciarVarredura(params, onProgress) {
    const { city, niche, mode, lat, lng } = params;
    const sendStatus = (msg) => onProgress({ type: 'status', message: msg });

    let termos = [];
    const listaNichos = Array.isArray(niche) ? niche : [niche];
    listaNichos.forEach(n => {
        const chave = n.toLowerCase().trim();
        termos.push(chave);
        if (SINONIMOS[chave]) termos.push(...SINONIMOS[chave]);
    });
    termos = [...new Set(termos)];

    sendStatus(`🚀 [MOTOR V12.1 - ANTI-RUÍDO] Buscando em @${lat},${lng}`);

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: null
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        for (const termo of termos) {
            let url = '';
            
            if (mode === 'map' && lat && lng) {
                url = `https://www.google.com.br/maps/search/${encodeURIComponent(termo)}/@${lat},${lng},15z?hl=pt-BR`;
            } else {
                const cidadeLimpa = city.replace(/🎯|Alvo no Mapa|\(.*\)/g, '').trim();
                url = `https://www.google.com.br/maps/search/${encodeURIComponent(termo + ' em ' + cidadeLimpa)}?hl=pt-BR`;
            }

            sendStatus(`📡 Radar fixado: ${termo}`);

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await new Promise(r => setTimeout(r, 5000)); 
            } catch (e) { continue; }

            await humanScroll(page);

            const leads = await page.evaluate((termoRef) => {
                const results = [];
                const items = document.querySelectorAll('div[role="article"], a[href*="/maps/place/"]');
                const vistos = new Set();

                items.forEach(item => {
                    let linkEl = item.tagName === 'A' ? item : item.querySelector('a[href*="/maps/place/"]');
                    if (!linkEl || !linkEl.href.includes('/place/')) return;
                    
                    const link = linkEl.href;
                    if (vistos.has(link)) return;
                    vistos.add(link);

                    const container = item.closest('div[role="article"]') || item.parentElement;
                    const text = container ? container.innerText : "";
                    const lines = text.split('\n');

                    const nome = linkEl.getAttribute('aria-label') || lines[0];
                    const telMatch = text.match(/(?:\(?\d{2}\)?\s?)?(?:9\d{4}[-\s]?\d{4}|\d{4}[-\s]?\d{4})/);

                    // --- FILTRO V12.1: LISTA NEGRA DE PALAVRAS ---
                    // Ignora qualquer linha que pareça status ou telefone
                    const filtroLixo = /(Aberto|Fechado|Fecha|Abre|Estrela|comentário|Filtro|Avaliaç|Fabricante|Congelado|Indústria|Pães|\(\d{2}\)|CNPJ)/i;

                    const regexCEP = /\d{5}-?\d{3}/;
                    const regexLogradouro = /(?:Rua|Av|Avenida|Travessa|Rod|Rodovia|Estrada|Servidão|Praça|Largo|Al\.)/i;

                    // 1. Tenta achar CEP (Ouro)
                    let addressLine = lines.find(l => regexCEP.test(l) && !filtroLixo.test(l));

                    // 2. Tenta achar Rua/Av (Prata)
                    if (!addressLine) {
                        addressLine = lines.find(l => regexLogradouro.test(l) && l.match(/\d+/) && !filtroLixo.test(l));
                    }

                    // 3. Tenta achar linha com vírgula e número (Bronze), mas aplica o filtro de lixo rigorosamente
                    if (!addressLine) {
                        addressLine = lines.find(l => 
                            l.includes(',') && 
                            l.match(/\d+/) && 
                            !filtroLixo.test(l) &&
                            l.length > 10 // Endereço muito curto geralmente é erro
                        );
                    }

                    const addressClean = (addressLine || "").replace(/·.*/g, '').replace(/ZAP.*/gi, '').trim();

                    // Extração de Cidade
                    let cidadeDetectada = "";
                    if (addressClean.length > 5) {
                        const partesEnd = addressClean.split(',');
                        if (partesEnd.length >= 2) {
                            let candidato = partesEnd[partesEnd.length - 2].trim();
                            if (candidato.includes('-')) {
                                candidato = candidato.split('-').pop().trim();
                            }
                            cidadeDetectada = candidato;
                        }
                    }

                    if (cidadeDetectada.length < 3 || !isNaN(parseInt(cidadeDetectada))) {
                        cidadeDetectada = ""; 
                    }

                    const finalAddress = addressClean.length > 10 ? addressClean : "Endereço não identificado";

                    results.push({
                        name: nome,
                        nome: nome,
                        niche: termoRef,
                        phone: telMatch ? telMatch[0] : "",
                        telefone: telMatch ? telMatch[0] : "",
                        address: finalAddress,
                        city: cidadeDetectada, 
                        link: link,
                        link_maps: link,
                        valido: true 
                    });
                });

                if (results.length === 0) console.error("[DIAGNÓSTICO] O scraper não extraiu leads.");
                return results;
            }, termo);

            if (leads.length > 0) {
                for (const lead of leads) {
                    await onProgress({ type: 'lead', data: lead }); 
                }
            }
        }
    } catch (erro) {
        console.error("ERRO NO MOTOR:", erro);
    } finally {
        await browser.close();
        sendStatus("🏁 Varredura finalizada.");
    }
}

module.exports = { iniciarVarredura };