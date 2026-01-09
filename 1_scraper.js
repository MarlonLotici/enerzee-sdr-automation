const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const connectDB = require('./src/config/database');
const Lead = require('./src/models/Lead');

puppeteer.use(StealthPlugin());

// --- INTELIGÊNCIA SEMÂNTICA: Dicionário de Expansão ---
const SINONIMOS = {
    'padaria': ['panificadora', 'confeitaria', 'fabricação de pães'],
    'mercado': ['supermercado', 'mercearia', 'mini mercado', 'atacarejo'],
    'farmacia': ['drogaria', 'farmácia de manipulação'],
    'academia': ['crossfit', 'estúdio de pilates', 'centro de treinamento', 'fitness'],
    'oficina': ['centro automotivo', 'mecânica', 'funilaria', 'auto center'],
    'restaurante': ['bistro', 'churrascaria', 'pizzaria', 'hamburgueria'],
    'escola': ['colégio', 'educação infantil', 'ensino médio'],
    'igreja': ['paróquia', 'templo', 'assembleia', 'comunidade cristã'],
    'industria': ['fábrica', 'confecção', 'metalúrgica', 'distribuidora']
};

// --- FUNÇÃO BATEDOR (MAPEAMENTO) ---
async function descobrirBairros(page, cidade) {
    console.log(`\n🕵️ [BATEDOR] Iniciando mapeamento tático em: ${cidade}...`);
    // Usa termos genéricos de alta capilaridade para desenhar o mapa
    const termoIsca = `Escolas e Igrejas em ${cidade}`;
    
    try {
        await page.goto(`https://www.google.com.br/maps/search/${encodeURIComponent(termoIsca)}`, {
            waitUntil: 'networkidle2', timeout: 45000
        });

        // Espera visual para garantir carregamento
        await new Promise(r => setTimeout(r, 2000));

        try {
            await page.waitForSelector('div[role="feed"]', { timeout: 10000 });
            await autoScroll(page, 3000); // Scroll curto de 3s para amostragem

            const bairros = await page.evaluate((cidadeRef) => {
                const items = document.querySelectorAll('div[role="article"]');
                const lista = new Set();
                
                items.forEach(item => {
                    const texto = item.innerText;
                    // Tenta capturar padrão: "Rua X, Bairro - Cidade"
                    const partes = texto.split(',');
                    partes.forEach(p => {
                        const parteLimpa = p.replace('-', '').trim();
                        // Filtros heurísticos para eliminar lixo
                        if (parteLimpa.length > 3 && 
                            !parteLimpa.match(/^\d+/) && 
                            !parteLimpa.includes(cidadeRef) && 
                            !parteLimpa.includes('CEP') &&
                            !parteLimpa.includes('Brasil')) {
                            lista.add(parteLimpa);
                        }
                    });
                });
                return Array.from(lista);
            }, cidade);

            // Filtro de Qualidade
            const bairrosValidos = bairros.filter(b => b.length < 25); // Remove frases longas
            
            if (bairrosValidos.length < 2) throw new Error("Poucos bairros");

            console.log(`✅ [BATEDOR] ${bairrosValidos.length} bairros identificados.`);
            return bairrosValidos;

        } catch (e) {
            throw new Error("Falha na extração visual");
        }
    } catch (e) {
        console.log("⚠️ [BATEDOR] Falha no mapeamento automático. Ativando Protocolo de Zonas.");
        return ['Centro', 'Zona Norte', 'Zona Sul', 'Zona Leste', 'Zona Oeste', 'Distrito Industrial'];
    }
}

// --- FUNÇÃO SCROLL ROBUSTA ---
async function autoScroll(page, maxTime = 0) {
    await page.evaluate(async (maxTime) => {
        const wrapper = document.querySelector('div[role="feed"]');
        if (!wrapper) return;
        await new Promise((resolve) => {
            var totalHeight = 0;
            var distance = 800; // Scroll mais suave
            const startTime = Date.now();
            var timer = setInterval(() => {
                var scrollHeight = wrapper.scrollHeight;
                wrapper.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight || (maxTime > 0 && Date.now() - startTime > maxTime)) {
                    clearInterval(timer);
                    resolve();
                }
            }, 800); // Intervalo maior para dar tempo de renderizar
        });
    }, maxTime);
}

// --- MOTOR PRINCIPAL ---
async function iniciarVarredura(cidadeAlvo, nichosEntrada) {
    // 1. Configuração Inicial
    console.log(`\n🚀 MOTOR EZEE CONNECT: ${cidadeAlvo}`);
    await connectDB();

    // 2. Normalização e Expansão de Nichos
    let termosDeBusca = [];
    nichosEntrada.forEach(nicho => {
        const base = nicho.toLowerCase().trim();
        termosDeBusca.push(base);
        if (SINONIMOS[base]) {
            termosDeBusca.push(...SINONIMOS[base]);
        }
    });
    // Remove duplicatas
    termosDeBusca = [...new Set(termosDeBusca)];

    console.log(`📋 Estratégia de Busca Expandida: [${termosDeBusca.join(', ')}]`);

    // 3. Lançamento do Browser
    const browser = await puppeteer.launch({
        headless: false, // Mantenha false para ver o mapa rodando (Visual)
        args: ['--start-maximized', '--no-sandbox']
    });

    const page = await browser.newPage();
    const leadsSessao = [];

    try {
        // Fase 1: Batedor
        let bairrosAlvo = await descobrirBairros(page, cidadeAlvo);
        if (!bairrosAlvo.includes('Centro')) bairrosAlvo.unshift('Centro');

        // Fase 2: Mineração Profunda
        for (const termo of termosDeBusca) {
            console.log(`\n🔨 MINERANDO NICHO: "${termo.toUpperCase()}"`);
            
            for (const bairro of bairrosAlvo) {
                const buscaGoogle = `${termo} em ${bairro}, ${cidadeAlvo}`;
                console.log(`   > Radar em: ${bairro}...`);

                try {
                    await page.goto(`https://www.google.com.br/maps/search/${encodeURIComponent(buscaGoogle)}`, {
                        waitUntil: 'networkidle2', timeout: 20000
                    });

                    // Verifica resultados
                    try {
                        await page.waitForSelector('div[role="feed"]', { timeout: 4000 });
                    } catch {
                        continue; // Pula se não tiver nada
                    }

                    await autoScroll(page);

                    // Extração de Dados
                    const leadsRaw = await page.evaluate((cat, cid, bairroRef) => {
                        const items = document.querySelectorAll('div[role="article"]');
                        const results = [];
                        
                        items.forEach(item => {
                            const linkEl = item.querySelector('a[href*="/maps/place/"]');
                            if (!linkEl) return;

                            const rawText = item.innerText;
                            const nome = linkEl.getAttribute('aria-label') || rawText.split('\n')[0];
                            
                            // Regex melhorada para telefone (pega com e sem DDD)
                            const telMatch = rawText.match(/(\(?\d{2}\)?\s?)?(9?\d{4}[-\s]?\d{4})/);
                            const telefone = telMatch ? telMatch[0] : "Não informado";

                            results.push({
                                nome: nome,
                                categoria: cat,
                                telefone: telefone,
                                link: linkEl.href,
                                bairro_detectado: bairroRef
                            });
                        });
                        return results;
                    }, termo, cidadeAlvo, bairro);

                    // Salvamento no Banco
                    for (const l of leadsRaw) {
                        const payload = { ...l, cidade: cidadeAlvo };
                        // Upsert para não duplicar
                        await Lead.findOneAndUpdate({ link_maps: l.link }, payload, { upsert: true });
                        leadsSessao.push(payload);
                    }
                    
                    if (leadsRaw.length > 0) console.log(`     + ${leadsRaw.length} leads capturados.`);

                } catch (err) {
                    console.log(`     x Erro técnico em ${bairro}`);
                }
            }
        }

    } catch (e) {
        console.error("Erro Crítico do Motor:", e);
    } finally {
        await browser.close();
        return leadsSessao;
    }
}

module.exports = { iniciarVarredura };