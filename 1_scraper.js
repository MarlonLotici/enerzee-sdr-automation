const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const SINONIMOS = {
    // 🥶 REFRIGERAÇÃO PESADA (Faturas Altíssimas)
    'mercado': ['supermercado', 'mercearia', 'atacarejo', 'minimercado'],
    'acougue': ['açougue', 'casa de carnes', 'frigorífico', 'boutique de carnes'],
    'distribuidora': ['distribuidora de bebidas', 'depósito de bebidas', 'conveniência'],
    'sorveteria': ['sorveteria', 'açaiteria', 'fábrica de sorvete'],
    
    // 🔥 CALOR E MOTORES (Vilões de Energia)
    'padaria': ['panificadora', 'confeitaria', 'padaria e confeitaria'],
    'lavanderia': ['lavanderia', 'lavagem a seco', 'lavanderia industrial'],
    'marcenaria': ['marcenaria', 'móveis planejados', 'serralheria', 'vidraçaria'],
    'petshop': ['pet shop', 'banho e tosa', 'clínica veterinária'],
    
    // ⚙️ SERVIÇOS E COMÉRCIO (Ar condicionado o dia todo)
    'restaurante': ['churrascaria', 'pizzaria', 'hamburgueria', 'lanchonete', 'restaurante'],
    'clinica': ['clínica médica', 'clínica de estética', 'clínica de imagem', 'laboratório'],
    'odontologia': ['clínica odontológica', 'consultório dentário', 'odontologia'],
    'farmacia': ['drogaria', 'farmácia de manipulação'],
    'beleza': ['salão de beleza', 'barbearia', 'estúdio de beleza'],
    
    // 🏭 INFRAESTRUTURA
    'oficina': ['oficina mecânica', 'auto center', 'funilaria e pintura'],
    'posto': ['posto de combustível', 'posto de gasolina'],
    'academia': ['academia', 'crossfit', 'estúdio fitness', 'pilates'],
    'hotel': ['hotel', 'pousada', 'motel', 'hostel'],
    'industria': ['fábrica', 'indústria', 'confecção', 'metalúrgica']
};

const delay = (ms) => new Promise(res => setTimeout(res, ms));

// ─── GRID DE COORDENADAS ──────────────────────────────────────────────────────

/**
 * Converte km em graus de latitude/longitude (aproximado)
 * 1 grau de latitude ≈ 111km
 * 1 grau de longitude ≈ 111km * cos(latitude)
 */
function kmToDegs(km, lat) {
    const latDeg = km / 111;
    const lngDeg = km / (111 * Math.cos(lat * Math.PI / 180));
    return { latDeg, lngDeg };
}

/**
 * Gera grid de pontos cobrindo uma área retangular
 * @param {number} centerLat - Latitude central
 * @param {number} centerLng - Longitude central  
 * @param {number} radiusKm - Raio em km (ou metade do lado do bounding box)
 * @param {number} gridSizeKm - Tamanho de cada quadrado em km
 * @returns {Array<{lat, lng}>} Lista de pontos centrais de cada quadrado
 */
function gerarGrid(centerLat, centerLng, radiusKm, gridSizeKm) {
    const { latDeg, lngDeg } = kmToDegs(gridSizeKm, centerLat);
    const { latDeg: rLatDeg, lngDeg: rLngDeg } = kmToDegs(radiusKm, centerLat);
    
    const pontos = [];
    
    for (let lat = centerLat - rLatDeg; lat <= centerLat + rLatDeg; lat += latDeg) {
        for (let lng = centerLng - rLngDeg; lng <= centerLng + rLngDeg; lng += lngDeg) {
            // Verifica se o ponto está dentro do círculo (não só do retângulo)
            const distKm = haversine(centerLat, centerLng, lat, lng);
            if (distKm <= radiusKm) {
                pontos.push({
                    lat: Math.round(lat * 10000) / 10000,
                    lng: Math.round(lng * 10000) / 10000,
                });
            }
        }
    }
    
    return pontos;
}

/**
 * Distância em km entre dois pontos (fórmula de Haversine)
 */
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Busca o bounding box de uma cidade via Nominatim
 * Retorna: { lat, lng, radiusKm } do centro e raio que cobre a cidade
 */
async function getCityBounds(cityName) {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityName)}&countrycodes=br&limit=1`,
            { headers: { 'User-Agent': 'ANTIX-Scraper/3.0' } }
        );
        const data = await res.json();
        
        if (!data || data.length === 0) {
            console.log(`⚠️ [GEO] Cidade "${cityName}" não encontrada. Usando coordenadas padrão.`);
            return null;
        }
        
        const city = data[0];
        const bbox = city.boundingbox; // [sul, norte, oeste, leste]
        
        const centerLat = parseFloat(city.lat);
        const centerLng = parseFloat(city.lon);
        
        // Calcula raio que cobre a cidade inteira
        const norte = parseFloat(bbox[1]);
        const sul = parseFloat(bbox[0]);
        const leste = parseFloat(bbox[3]);
        const oeste = parseFloat(bbox[2]);
        
        const distVertical = haversine(sul, centerLng, norte, centerLng);
        const distHorizontal = haversine(centerLat, oeste, centerLat, leste);
        const radiusKm = Math.max(distVertical, distHorizontal) / 2;
        
        console.log(`🌍 [GEO] ${cityName}: centro (${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}), raio ${radiusKm.toFixed(1)}km`);
        
        return { lat: centerLat, lng: centerLng, radiusKm: Math.min(radiusKm, 50) }; // Max 50km
        
    } catch (err) {
        console.log(`⚠️ [GEO] Erro ao buscar cidade: ${err.message}`);
        return null;
    }
}

// ─── SCROLL E EXTRAÇÃO ────────────────────────────────────────────────────────

async function humanScroll(page) {
    await page.evaluate(async () => {
        const wrapper = document.querySelector('div[role="feed"]');
        if (!wrapper) return;
        await new Promise((resolve) => {
            let lastHeight = 0;
            let tentativas = 0;
            let totalScrolls = 0;
            
            const timer = setInterval(() => {
                const scrollAmount = 400 + Math.floor(Math.random() * 400);
                wrapper.scrollBy(0, scrollAmount);
                totalScrolls++;
                
                if (wrapper.scrollHeight === lastHeight) tentativas++;
                else tentativas = 0;
                lastHeight = wrapper.scrollHeight;
                
                if (tentativas >= 12 || totalScrolls >= 60) {
                    clearInterval(timer);
                    resolve();
                }
            }, 600 + Math.floor(Math.random() * 600));
        });
    });
}

async function extrairLeadDaPagina(page, url, termo, cidade, gridPoint) {
    return await page.evaluate((urlLead, termoRef, cidadeRef, gridPt) => {
        const nome = document.querySelector('h1')?.innerText || "";
        
        const lixo = ["prefeitura", "município", "resultados", "filtros", "ordenar",
                      "google", "mais", "câmara", "secretaria", "tribunal", "fórum",
                      "delegacia", "bombeiros", "samu", "ibge"];
        if (!nome || nome.length < 3 || lixo.some(word => nome.toLowerCase().includes(word))) return null;

        // Telefone: botão específico primeiro
        let telefone = null;
        const btnTel = document.querySelector('button[data-item-id="phone:tel"]')
                    || document.querySelector('button[data-item-id*="phone"]')
                    || document.querySelector('a[data-item-id*="phone"]');
        if (btnTel) {
            const telText = btnTel.innerText || btnTel.getAttribute('aria-label') || '';
            const matchBtn = telText.match(/(\(?\d{2}\)?\s?)(9?\d{4}[-\s]?\d{4})/);
            if (matchBtn) telefone = matchBtn[0];
        }
        if (!telefone) {
            const corpo = document.body.innerText;
            const matchCorpo = corpo.match(/(\(?\d{2}\)?\s?)(9?\d{4}[-\s]?\d{4})/);
            if (matchCorpo) telefone = matchCorpo[0];
        }
        if (!telefone) return null;

        // Endereço
        let endereco = "Não identificado";
        const btnEnd = document.querySelector('button[data-item-id="address"]');
        if (btnEnd) endereco = btnEnd.innerText;

        // Rating e Reviews
        let rating = null;
        let reviews = 0;
        const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]')
                      || document.querySelector('span.ceNzKf');
        if (ratingEl) {
            const rVal = parseFloat(ratingEl.innerText.replace(',', '.'));
            if (!isNaN(rVal) && rVal > 0 && rVal <= 5) rating = rVal;
        }
        const reviewEl = document.querySelector('span[aria-label*="comentário"]')
                      || document.querySelector('span[aria-label*="review"]')
                      || document.querySelector('span[aria-label*="avalia"]');
        if (reviewEl) {
            const rMatch = reviewEl.getAttribute('aria-label').match(/(\d[\d.]*)/);
            if (rMatch) reviews = parseInt(rMatch[1].replace('.', ''));
        }

        // Horário
        let horario = null;
        const btnHorario = document.querySelector('button[data-item-id*="hour"]');
        if (btnHorario) {
            const hText = btnHorario.innerText || '';
            if (hText.length < 100) horario = hText.split('\n')[0];
        }

        // Categoria
        let categoria = null;
        const catEl = document.querySelector('button[jsaction*="category"]')
                   || document.querySelector('.DkEaL');
        if (catEl) categoria = catEl.innerText;

        // Website
        let website = null;
        const btnSite = document.querySelector('a[data-item-id="authority"]');
        if (btnSite) website = btnSite.href;

        // Coordenadas
        const coordMatch = urlLead.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        
        // Bairro: tenta extrair do endereço
        let bairro = null;
        if (endereco && endereco.includes('-')) {
            const partes = endereco.split('-');
            if (partes.length > 1) {
                const posHifen = partes[partes.length - 1];
                const bairroSujo = posHifen.split(',')[0].trim();
                if (bairroSujo.length > 2 && isNaN(parseInt(bairroSujo))) {
                    bairro = bairroSujo;
                }
            }
        }
        const ufMatch = endereco.match(/-\s([A-Z]{2}),?\s\d{5}/);
        const estadoExtraido = ufMatch ? ufMatch[1] : null;
        return {
            name: nome,
            niche: termoRef,
            phone: telefone,
            address: endereco,
            city: cidadeRef,
            bairro: bairro,
            estado: estadoExtraido,
            link: urlLead,
            lat: coordMatch ? parseFloat(coordMatch[1]) : gridPt.lat,
            lng: coordMatch ? parseFloat(coordMatch[2]) : gridPt.lng,
            rating, reviews, horario, categoria, website,
            valido: true
        };
    }, url, termo, cidade, gridPoint);
}

// ─── MOTOR PRINCIPAL ──────────────────────────────────────────────────────────

async function iniciarVarredura(params, onProgress, shouldStop = () => false) {
    const { city, niche, lat, lng, radius, mode, instanceId, userId } = params;
    const sendStatus = (msg) => onProgress({ type: 'status', message: msg });

    // ── 1. Montar termos de busca (máx 3 por nicho) ──
    let termos = [];
    const listaNichos = Array.isArray(niche) ? niche : [niche || "comércio"];
    listaNichos.forEach(n => {
        let val = (typeof n === 'object' && n.keywords) ? n.keywords : n;
        if (typeof val === 'string') {
            const chave = val.toLowerCase().trim();
            termos.push(chave);
            if (SINONIMOS[chave]) termos.push(...SINONIMOS[chave].slice(0, 2));
        }
    });
    termos = [...new Set(termos)];
    console.log(`🎯 [TERMOS] ${termos.length} termos: ${termos.join(', ')}`);

    // ── 2. Determinar área de busca ──
let centerLat, centerLng, radiusKm;

if (mode === 'map' && lat && lng) {
    // Modo mapa: usa coordenadas e raio do frontend
    centerLat = lat;
    centerLng = lng;
    radiusKm = parseFloat(radius) || 5;
    console.log(`📍 [MODO MAPA] Centro: (${centerLat}, ${centerLng}), Raio: ${radiusKm}km`);
} else if (city) {
        // Modo cidade: busca bounding box automaticamente
        const bounds = await getCityBounds(city);
        if (bounds) {
            centerLat = bounds.lat;
            centerLng = bounds.lng;
            radiusKm = bounds.radiusKm;
        } else {
            // Fallback: se não achar a cidade, usa coordenadas enviadas pelo frontend
            centerLat = lat || -15.7801;
            centerLng = lng || -47.9292;
            radiusKm = 10;
        }
        console.log(`🏙️ [MODO CIDADE] ${city}: centro (${centerLat}, ${centerLng}), raio ${radiusKm}km`);
    } else {
        console.log('❌ [ERRO] Sem cidade nem coordenadas. Abortando.');
        return;
    }

    // ── 3. Gerar grid adaptativo ──
    // Cidades pequenas (raio < 5km): grid de 1km
    // Cidades médias (5-15km): grid de 1.5km  
    // Cidades grandes (>15km): grid de 2km (depois subdivide onde necessário)
    let gridSizeKm;
    if (radiusKm <= 5) gridSizeKm = 1;
    else if (radiusKm <= 15) gridSizeKm = 1.5;
    else gridSizeKm = 2;

    const gridPoints = gerarGrid(centerLat, centerLng, radiusKm, gridSizeKm);
    console.log(`🗺️ [GRID] ${gridPoints.length} quadrados de ${gridSizeKm}km gerados (raio ${radiusKm.toFixed(1)}km)`);

    // ── 4. Filtrar quadrados já varridos (se tiver persistência) ──
    let pontosParaVarrer = gridPoints;
    // TODO: Quando integrar com Supabase, filtrar pontos que já estão na tabela scraping_grid
    // Por enquanto varre tudo

    sendStatus(`Grid gerado: ${pontosParaVarrer.length} áreas para varrer com ${termos.length} termos`);

    // ── 5. Cache de deduplicação ──
    const telefonesVistos = new Set();
    const linksVistos = new Set();
    let totalExtraidos = 0;
    let totalDuplicados = 0;
    let totalSemTelefone = 0;
    let quadradosVarridos = 0;
    const pontosParaSubdividir = []; // Grid adaptativo

    // ── 6. Processar em lotes ──
    const LOTE_SIZE = 8; // Quadrados por sessão de browser
    const lotes = [];
    for (let i = 0; i < pontosParaVarrer.length; i += LOTE_SIZE) {
        lotes.push(pontosParaVarrer.slice(i, i + LOTE_SIZE));
    }

    console.log(`🔥 [MOTOR] ${lotes.length} lotes de ${LOTE_SIZE} quadrados cada`);

    try {
        for (let loteIdx = 0; loteIdx < lotes.length; loteIdx++) {
            if (shouldStop()) break;

            const loteAtual = lotes[loteIdx];
            console.log(`\n🔄 [LOTE ${loteIdx + 1}/${lotes.length}] ${loteAtual.length} quadrados`);

            const browser = await puppeteer.launch({
                headless: "new",
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor'
                ]
            });

            try {
                for (const ponto of loteAtual) {
                    if (shouldStop()) break;

                    for (const termo of termos) {
                        if (shouldStop()) break;

                        // Busca por coordenadas: o Google Maps aceita busca com @lat,lng,zoom
                        const searchUrl = `https://www.google.com.br/maps/search/${encodeURIComponent(termo)}/@${ponto.lat},${ponto.lng},15z?hl=pt-BR`;
                        
                        console.log(`📡 [GRID ${quadradosVarridos + 1}/${pontosParaVarrer.length}] "${termo}" em (${ponto.lat}, ${ponto.lng})`);

                        const page = await browser.newPage();
                        await page.setViewport({ width: 1280, height: 900 });

                        try {
                            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                            // Espera o feed carregar
                            try {
                                await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
                            } catch {
                                // Sem feed = sem resultados nessa área
                                await page.close();
                                continue;
                            }

                            // Scroll
                            await humanScroll(page);

                            // Conta resultados
                            const linksLeads = await page.evaluate(() => {
                                return Array.from(document.querySelectorAll('a[href*="/maps/place/"]')).map(a => a.href);
                            });

                            const feedCount = linksLeads.length;

                            // Grid adaptativo: se muitos resultados, marcar para subdivisão
                            if (feedCount >= 80 && gridSizeKm > 1) {
                                pontosParaSubdividir.push(ponto);
                                console.log(`🔬 [ADAPTATIVO] Ponto (${ponto.lat}, ${ponto.lng}) tem ${feedCount}+ resultados — marcado para subdivisão`);
                            }

                            // Filtrar links já visitados
                            const linksNovos = linksLeads.filter(link => {
                                if (linksVistos.has(link)) return false;
                                linksVistos.add(link);
                                return true;
                            });

                            if (linksNovos.length === 0) {
                                await page.close();
                                continue;
                            }

                            console.log(`🔗 ${feedCount} encontrados, ${linksNovos.length} novos`);

                            // Extrair cada lead
                            for (let i = 0; i < linksNovos.length; i++) {
                                if (shouldStop()) break;

                                try {
                                    await page.goto(linksNovos[i], { waitUntil: 'domcontentloaded', timeout: 25000 });
                                    await delay(800 + Math.floor(Math.random() * 800));

                                    const leadInfo = await extrairLeadDaPagina(page, linksNovos[i], termo, city || 'Mapa', ponto);

                                    if (!leadInfo) {
                                        totalSemTelefone++;
                                        continue;
                                    }

                                    // Dedup por telefone
                                    const telNorm = leadInfo.phone.replace(/\D/g, '').slice(-11);
                                    if (telefonesVistos.has(telNorm)) {
                                        totalDuplicados++;
                                        continue;
                                    }
                                    telefonesVistos.add(telNorm);
                                    totalExtraidos++;

                                    console.log(`✅ [#${totalExtraidos}] ${leadInfo.name} | ${leadInfo.phone} | ⭐${leadInfo.rating || '?'}`);
                                    await onProgress({ type: 'lead', data: leadInfo });

                                    // Status a cada 25 leads
                                    if (totalExtraidos % 25 === 0) {
                                        sendStatus(`${totalExtraidos} leads extraídos | ${quadradosVarridos}/${pontosParaVarrer.length} áreas | ${totalDuplicados} duplicados filtrados`);
                                    }

                                } catch (e) {
                                    // Lead individual falhou, continua
                                }
                            }

                            await page.close();

                        } catch (err) {
                            console.log(`⚠️ Erro na busca: ${err.message}`);
                            try { await page.close(); } catch {}
                        }
                    }

                    quadradosVarridos++;
                    
                    // Log de progresso por quadrado
                    const pctGrid = Math.round(quadradosVarridos / pontosParaVarrer.length * 100);
                    onProgress({ 
                        type: 'progress', 
                        data: { 
                            percent: pctGrid, 
                            extracted: totalExtraidos, 
                            scanned: quadradosVarridos, 
                            total: pontosParaVarrer.length 
                        } 
                    });
                }

            } finally {
                await browser.close();
                await delay(2000);
            }
        }

        // ── 7. Grid adaptativo: subdividir e varrer áreas densas ──
        if (pontosParaSubdividir.length > 0 && !shouldStop()) {
            console.log(`\n🔬 [FASE 2] Subdividindo ${pontosParaSubdividir.length} áreas densas em grid de ${gridSizeKm/2}km`);
            
            const subGridSize = gridSizeKm / 2;
            const subPoints = [];
            
            for (const ponto of pontosParaSubdividir) {
                const { latDeg, lngDeg } = kmToDegs(subGridSize, ponto.lat);
                // Gera 4 sub-pontos (divide o quadrado em 4)
                subPoints.push(
                    { lat: Math.round((ponto.lat - latDeg/2) * 10000) / 10000, lng: Math.round((ponto.lng - lngDeg/2) * 10000) / 10000 },
                    { lat: Math.round((ponto.lat - latDeg/2) * 10000) / 10000, lng: Math.round((ponto.lng + lngDeg/2) * 10000) / 10000 },
                    { lat: Math.round((ponto.lat + latDeg/2) * 10000) / 10000, lng: Math.round((ponto.lng - lngDeg/2) * 10000) / 10000 },
                    { lat: Math.round((ponto.lat + latDeg/2) * 10000) / 10000, lng: Math.round((ponto.lng + lngDeg/2) * 10000) / 10000 },
                );
            }

            console.log(`🔬 [FASE 2] ${subPoints.length} sub-quadrados gerados`);
            
            // Varre os sub-quadrados (reutiliza a mesma lógica)
            const subBrowser = await puppeteer.launch({
                headless: "new",
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });

            try {
                for (const subPonto of subPoints) {
                    if (shouldStop()) break;

                    for (const termo of termos) {
                        if (shouldStop()) break;

                        const searchUrl = `https://www.google.com.br/maps/search/${encodeURIComponent(termo)}/@${subPonto.lat},${subPonto.lng},16z?hl=pt-BR`;
                        const page = await subBrowser.newPage();
                        await page.setViewport({ width: 1280, height: 900 });

                        try {
                            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                            try { await page.waitForSelector('div[role="feed"]', { timeout: 15000 }); }
                            catch { await page.close(); continue; }

                            await humanScroll(page);

                            const linksLeads = await page.evaluate(() =>
                                Array.from(document.querySelectorAll('a[href*="/maps/place/"]')).map(a => a.href)
                            );

                            const linksNovos = linksLeads.filter(link => {
                                if (linksVistos.has(link)) return false;
                                linksVistos.add(link);
                                return true;
                            });

                            for (const link of linksNovos) {
                                if (shouldStop()) break;
                                try {
                                    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 25000 });
                                    await delay(800 + Math.floor(Math.random() * 800));

                                    const leadInfo = await extrairLeadDaPagina(page, link, termo, city || 'Mapa', subPonto);
                                    if (!leadInfo) { totalSemTelefone++; continue; }

                                    const telNorm = leadInfo.phone.replace(/\D/g, '').slice(-11);
                                    if (telefonesVistos.has(telNorm)) { totalDuplicados++; continue; }
                                    telefonesVistos.add(telNorm);
                                    totalExtraidos++;

                                    console.log(`✅ [SUB #${totalExtraidos}] ${leadInfo.name} | ${leadInfo.phone}`);
                                    await onProgress({ type: 'lead', data: leadInfo });
                                } catch {}
                            }

                            await page.close();
                        } catch {
                            try { await page.close(); } catch {}
                        }
                    }
                }
            } finally {
                await subBrowser.close();
            }
        }

    } catch (err) {
        console.error("🔥 ERRO NO MOTOR:", err);
    } finally {
        console.log('\n========================================');
        console.log('📊 RELATÓRIO FINAL DA VARREDURA');
        console.log('========================================');
        console.log(`Quadrados varridos: ${quadradosVarridos}/${pontosParaVarrer.length}`);
        console.log(`Áreas subdivididas: ${pontosParaSubdividir.length}`);
        console.log(`Leads extraídos: ${totalExtraidos}`);
        console.log(`Duplicados filtrados: ${totalDuplicados}`);
        console.log(`Sem telefone: ${totalSemTelefone}`);
        console.log(`Links visitados: ${linksVistos.size}`);
        console.log('========================================');
        
        sendStatus(`🏁 Varredura completa: ${totalExtraidos} leads extraídos de ${quadradosVarridos} áreas`);
    }
}

module.exports = { iniciarVarredura };