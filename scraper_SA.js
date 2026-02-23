/**
 * MISSÃO SANTO ANDRÉ - EDIÇÃO HIGH PERFORMANCE
 * Fluxo: Scraper -> Clean -> Enrich -> Supabase
 */
require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Importando seus membros oficiais
const db = require('./database'); 
const { processarLimpeza } = require('./2_clean');
const { enriquecerLeadIndividual } = require('./3_enrich');

puppeteer.use(StealthPlugin());

// --- CONFIGURAÇÃO ---
const INSTANCE_ID = "a5e45805-abb4-4d76-a387-5a22b34c6bb4"; 
const CIDADE = "Santo André, SP";
const BAIRROS = [
    "Centro", "Bairro Jardim", "Campestre", "Vila Assunção", "Vila Bastos", 
    "Vila Alpina", "Vila Guiomar", "Vila Gilda", "Vila Pires", "Vila Alzira", 
    "Vila Helena", "Vila Alice", "Vila Humaitá", "Vila Curuçá", "Vila Floresta", 
    "Vila Scarpelli", "Vila Metalúrgica", "Vila Lucinda", "Vila Palmares", 
    "Utinga", "Camilópolis", "Santa Teresinha", "Parque das Nações", 
    "Parque Jaçatuba", "Parque Novo Oratório", "Parque Oratório", 
    "Parque Erasmo Assunção", "Parque Capuava", "Parque Marajoara", 
    "Gerassi", "Cidade São Jorge", "Jardim Santo Alberto", "Jardim Nice", 
    "Jardim das Maravilhas", "Jardim Utinga", "Jardim Vila Rica", 
    "Jardim Santo André", "Jardim Marek", "Jardim do Estádio", "Jardim Bela Vista", 
    "Casa Branca", "Jardim Bom Pastor", "Vila Luzita", "Vila João Ramalho", 
    "Vila Linda", "Vila Suíça", "Cata Preta", "Represa", "Sítio dos Viana"
];

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function iniciarMissaoSDR() {
    console.log(`🎯 Iniciando captura e enriquecimento em ${CIDADE}...`);
    
    const browser = await puppeteer.launch({
        headless: false, // Recomendado manter visível para monitorar bloqueios
        args: ['--start-maximized', '--no-sandbox']
    });

    const page = await browser.newPage();
    let totalProcessado = 0;

    for (const bairro of BAIRROS) {
        const query = `padaria em ${bairro}, ${CIDADE}`;
        console.log(`\n🔎 ZONA ATUAL: ${bairro}`);
        
        try {
            await page.goto(`https://www.google.com.br/maps/search/${encodeURIComponent(query)}?hl=pt-BR`);
            await delay(4000);

            const links = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a[href*="/maps/place/"]'))
                    .map(a => a.href).slice(0, 10); // 10 por bairro para ser rápido
            });

            for (const link of links) {
                try {
                    await page.goto(link, { waitUntil: 'domcontentloaded' });
                    await delay(2000);

                    // 1. Extração Básica (Membro 1)
                    const raw = await page.evaluate((url, b) => {
                        const nome = document.querySelector('h1.DUwDvf')?.innerText;
                        const texto = document.body.innerText;
                        const matchTel = texto.match(/(\(?\d{2}\)?\s?)?(9?\d{4}[-\s]?\d{4})/);
                        if (!nome || !matchTel) return null;

                        return {
                            name: nome,
                            phone: matchTel[0],
                            address: document.querySelector('button[data-item-id="address"]')?.innerText || "",
                            city: "Santo André",
                            bairro: b,
                            link: url,
                            niche: "Padaria"
                        };
                    }, link, bairro);

                    if (raw) {
                        // 2. Higienização (Membro 2)
                        const limpos = processarLimpeza([raw]);
                        if (limpos.length > 0) {
                            let leadParaEnriquecer = limpos[0];

                            // 3. ENRIQUECIMENTO (Membro 3 - BUSCA O DONO)
                            console.log(`🧠 Enriquecendo: ${leadParaEnriquecer.name}...`);
                            const leadEnriquecido = await enriquecerLeadIndividual(leadParaEnriquecer);

                            // 4. Salvar no Banco (Membro 5)
                            leadEnriquecido.status = 'new';
                            const { error } = await db.saveLead(leadEnriquecido, INSTANCE_ID);

                            if (!error) {
                                totalProcessado++;
                                const dono = leadEnriquecido.dono ? `Dono: ${leadEnriquecido.dono}` : "Dono não achado";
                                console.log(`✅ [${totalProcessado}] ${leadEnriquecido.name} | ${dono}`);
                            }
                        }
                    }
                } catch (e) { console.log(`⚠️ Erro no lead: ${e.message}`); }
            }
        } catch (e) { console.log(`❌ Erro no bairro ${bairro}`); }
    }

    console.log(`\n🏁 Missão cumprida! ${totalProcessado} leads prontos para o SDR.`);
    await browser.close();
}

iniciarMissaoSDR();