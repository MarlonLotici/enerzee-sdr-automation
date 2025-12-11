const puppeteer = require('puppeteer');
const fs = require('fs');

// CONFIGURAÇÃO
const NOME_ARQUIVO = 'leads_bh_massivo.csv';
const CABECALHO = 'Cluster;Categoria;Nome;Telefone;Nota;Avaliacoes;Endereco;Link\n';

(async () => {
    // Cria arquivo se não existir
    if (!fs.existsSync(NOME_ARQUIVO)) {
        fs.writeFileSync(NOME_ARQUIVO, '\uFEFF' + CABECALHO);
    }

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized', '--no-sandbox']
    });

    const page = await browser.newPage();
    // Disfarce de Navegador Real
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // --- A LISTA MESTRA DE ALVOS (BH SETORIZADA) ---
    const alvos = [
        // --- 1. CLUSTER DA MODA E CONFECÇÃO (Consumo: Ferros Industriais/Máquinas) ---
        // Barro Preto e Prado concentram a indústria da moda mineira
        { termo: 'Confecção de Roupas no Barro Preto Belo Horizonte', cat: 'Ind. Moda - Barro Preto' },
        { termo: 'Confecção de Roupas no Prado Belo Horizonte', cat: 'Ind. Moda - Prado' },
        { termo: 'Estamparia em Belo Horizonte', cat: 'Ind. Estamparia - Geral' },

        // --- 2. CLUSTER AUTOMOTIVO (Consumo: Compressores e Estufas) ---
        // A Av. Pedro II (Carlos Prates/Caiçara) é o maior polo automotivo
        { termo: 'Centro Automotivo na Pedro II Belo Horizonte', cat: 'Auto - Pedro II' },
        { termo: 'Lanternagem e Pintura em Belo Horizonte', cat: 'Auto - Pintura' },
        { termo: 'Retífica de Motores em Belo Horizonte', cat: 'Auto - Retifica' },

        // --- 3. PEQUENAS INDÚSTRIAS E LOGÍSTICA ---
        // Olhos d'Água e São Francisco são bairros mistos/industriais
        { termo: 'Indústria no Bairro Olhos d\'Água Belo Horizonte', cat: 'Indústria - Olhos dAgua' },
        { termo: 'Distribuidora no Bairro São Francisco Belo Horizonte', cat: 'Logistica - Sao Francisco' },
        { termo: 'Marmoraria em Belo Horizonte', cat: 'Ind. Marmoraria' },
        { termo: 'Vidraçaria em Belo Horizonte', cat: 'Ind. Vidros' },

        // --- 4. CLUSTER GASTRONÔMICO NOBRE (Consumo: Ar Condicionado + Fornos) ---
        // Savassi, Lourdes e Funcionários
        { termo: 'Restaurante na Savassi Belo Horizonte', cat: 'Gastro - Savassi' },
        { termo: 'Padaria no Lourdes Belo Horizonte', cat: 'Padaria - Lourdes' },
        { termo: 'Restaurante no Funcionários Belo Horizonte', cat: 'Gastro - Funcionarios' },
        { termo: 'Cervejaria Artesanal em Belo Horizonte', cat: 'Ind. Cervejaria' }, // Nicho em alta

        // --- 5. CLUSTER COMÉRCIO POPULAR (Volume Massivo) ---
        // Barreiro e Venda Nova são "cidades" dentro de BH
        { termo: 'Supermercado no Barreiro Belo Horizonte', cat: 'Mercado - Barreiro' },
        { termo: 'Açougue no Barreiro Belo Horizonte', cat: 'Acougue - Barreiro' },
        { termo: 'Padaria em Venda Nova Belo Horizonte', cat: 'Padaria - Venda Nova' },
        { termo: 'Sorveteria em Venda Nova Belo Horizonte', cat: 'Sorveteria - Venda Nova' },
        
        // --- 6. PAMPULHA E VETOR NORTE (Misto) ---
        // Castelo e Ouro Preto têm comércio de rua fortíssimo
        { termo: 'Academia no Bairro Castelo Belo Horizonte', cat: 'Academia - Castelo' },
        { termo: 'Padaria no Bairro Ouro Preto Belo Horizonte', cat: 'Padaria - Ouro Preto' },
        { termo: 'Restaurante na Pampulha Belo Horizonte', cat: 'Gastro - Pampulha' },

        // --- 7. BAIRROS "CORINGA" (Alta densidade comercial) ---
        // Buritis, Sagrada Família, Cidade Nova
        { termo: 'Padaria no Buritis Belo Horizonte', cat: 'Padaria - Buritis' },
        { termo: 'Mercado na Sagrada Família Belo Horizonte', cat: 'Mercado - Sagrada Familia' },
        { termo: 'Clínica na Cidade Nova Belo Horizonte', cat: 'Clinica - Cidade Nova' },
        { termo: 'Padaria no Padre Eustáquio Belo Horizonte', cat: 'Padaria - Padre Eustaquio' }
    ];

    console.log(`🔥 INICIANDO MEGA OPERAÇÃO BH: ${alvos.length} NICHOS MAPEADOS...\n`);

    for (const alvo of alvos) {
        console.log(`🔎 [${alvo.cat}] Buscando: "${alvo.termo}"`);

        try {
            // URL montada dinamicamente
            const url = `https://www.google.com/maps/search/${alvo.termo.split(' ').join('+')}`;
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 }); // 90s timeout

            // Verifica se carregou
            try {
                await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
            } catch (e) {
                console.log(`⚠️  Lista vazia ou bloqueada para "${alvo.termo}". Pulando...`);
                continue;
            }

            console.log('⬇️  Rolando a lista...');
            await autoScroll(page);

            // EXTRAÇÃO INTELIGENTE
            const leads = await page.evaluate((clusterName) => {
                const data = [];
                const items = document.querySelectorAll('div[role="article"]');

                items.forEach(item => {
                    const text = item.innerText;
                    
                    // Regex seguro para telefone
                    const telMatch = text.match(/(\(?\d{2}\)?\s)?\d{4,5}-?\d{4}/);
                    if (!telMatch) return; // Sem telefone = lixo

                    const linkEl = item.querySelector('a[href*="/maps/place/"]');
                    if (!linkEl) return;

                    const nome = linkEl.getAttribute('aria-label') || text.split('\n')[0];
                    
                    // Pega Nota e Avaliações (ex: "4.5 (100)")
                    let nota = '0', reviews = '0';
                    const ratingMatch = text.match(/(\d[\.,]\d)\s?\(([\d\.]+)\)/);
                    if (ratingMatch) {
                        nota = ratingMatch[1];
                        reviews = ratingMatch[2].replace('.', '');
                    }

                    // Tenta achar endereço na "massaroca" de texto
                    const linhas = text.split('\n');
                    let endereco = 'BH - Geral';
                    for (let l of linhas) {
                        if (l.match(/(Rua|Av\.|Alameda|Rodovia|Bairro)/i)) {
                            endereco = l;
                            break;
                        }
                    }

                    data.push({
                        cluster: clusterName,
                        nome: nome.replace(/;/g, ','),
                        telefone: telMatch[0],
                        nota,
                        reviews,
                        endereco: endereco.replace(/;/g, ','),
                        link: linkEl.href
                    });
                });
                return data;
            }, alvo.cat);

            // FILTRO DE QUALIDADE ANTES DE SALVAR
            // Só salva quem tem mais de 10 avaliações (evita lugar fantasma/fechado)
            const leadsQualificados = leads.filter(l => parseInt(l.reviews) > 10);

            if (leadsQualificados.length > 0) {
                const csvData = leadsQualificados.map(l => 
                    `${l.cluster};${l.categoria};${l.nome};${l.telefone};${l.nota};${l.reviews};${l.endereco};${l.link}`
                ).join('\n') + '\n';

                fs.appendFileSync(NOME_ARQUIVO, csvData);
                console.log(`✅ ${leadsQualificados.length} leads salvos (Filtrados de ${leads.length} originais)`);
            } else {
                console.log(`⚠️  Encontrei lojas, mas poucas avaliações (Provavelmente irrelevantes).`);
            }

        } catch (error) {
            console.log(`❌ Erro em ${alvo.termo}: ${error.message}`);
        }

        // Delay Humano (4 a 8 segundos) - Essencial para lista grande
        const delay = Math.floor(Math.random() * 4000) + 4000;
        await new Promise(r => setTimeout(r, delay));
    }

    console.log(`\n🏁 FIM DA EXTRAÇÃO! Arquivo: ${NOME_ARQUIVO}`);
    await browser.close();
})();

// SCROLL INFINITO OTIMIZADO
async function autoScroll(page) {
    await page.evaluate(async () => {
        const wrapper = document.querySelector('div[role="feed"]');
        if (!wrapper) return;
        await new Promise((resolve) => {
            var totalHeight = 0;
            var distance = 3000; // Scroll mais rápido
            var tentativas = 0;
            var timer = setInterval(() => {
                var scrollHeight = wrapper.scrollHeight;
                wrapper.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    totalHeight = scrollHeight;
                    tentativas++;
                } else {
                    tentativas = 0;
                }
                // Para se tentar 8 vezes sem sucesso ou passar de 400 itens (limite do Google)
                if (tentativas >= 8 || scrollHeight > 500000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 600);
        });
    });
}