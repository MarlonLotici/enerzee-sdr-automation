const puppeteer = require('puppeteer');
const ExcelJS = require('exceljs');
const fs = require('fs');
const https = require('https');

// --- CONFIGURAÇÃO ---
const ARQUIVO_ENTRADA = 'leads_prontos_para_enrich.xlsx'; 
const ARQUIVO_SAIDA = 'LEADS_PREMIUM_FINAL.xlsx';

// --- FUNÇÕES AUXILIARES ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Função para formatar dinheiro (Capital Social)
const formatMoney = (val) => val ? `R$ ${parseFloat(val).toLocaleString('pt-BR')}` : 'N/A';

// Função para identificar se é celular (Começa com 9 e tem tamanho certo)
const isCelular = (num) => {
    const limpo = num.replace(/\D/g, '');
    return limpo.length === 11 && limpo[2] === '9';
};

// Consulta BrasilAPI
async function consultarBrasilAPI(cnpj) {
    return new Promise((resolve) => {
        https.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                } else resolve(null);
            });
        }).on('error', () => resolve(null));
    });
}

// Consulta MinhaReceita (Backup)
async function consultarMinhaReceita(cnpj) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'minhareceita.org',
            path: `/${cnpj}`,
            method: 'GET',
            headers: { 'User-Agent': 'Node.js Bot' }
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                } else resolve(null);
            });
        }).on('error', () => resolve(null));
    });
}

(async () => {
    console.log(`💎 INICIANDO ENRIQUECIMENTO PREMIUM (DADOS COMPLETOS)...`);

    if (!fs.existsSync(ARQUIVO_ENTRADA)) {
        console.log(`❌ Erro: Arquivo '${ARQUIVO_ENTRADA}' não encontrado.`);
        return;
    }

    const workbookEntrada = new ExcelJS.Workbook();
    await workbookEntrada.xlsx.readFile(ARQUIVO_ENTRADA);
    const sheetEntrada = workbookEntrada.getWorksheet(1);

    const workbookSaida = new ExcelJS.Workbook();
    const sheetSaida = workbookSaida.addWorksheet('Leads Premium');
    
    // CABEÇALHO EXPANDIDO
    sheetSaida.columns = [
        { header: 'Empresa', key: 'nome', width: 35 },
        { header: 'Telefone Maps', key: 'tel_maps', width: 15 },
        { header: 'Dono/Sócio', key: 'dono', width: 30 },
        { header: 'Telefone Extra (CNPJ)', key: 'tel_extra', width: 18 }, // AQUI ESTÁ O OURO
        { header: 'Email', key: 'email', width: 25 },
        { header: 'Capital Social', key: 'capital', width: 15 },
        { header: 'CNPJ', key: 'cnpj', width: 18 },
        { header: 'Endereço', key: 'end', width: 30 },
        { header: 'Link Maps', key: 'link', width: 10 }
    ];

    const browser = await puppeteer.launch({ 
        headless: false, 
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled'] 
    });
    const page = await browser.newPage();

    const totalLinhas = sheetEntrada.rowCount;
    let sucessos = 0;

    console.log(`📊 Processando ${totalLinhas - 1} empresas...`);

    for (let i = 2; i <= totalLinhas; i++) {
        const row = sheetEntrada.getRow(i);
        
        // Ajuste os índices conforme seu arquivo de entrada
        const nomeEmpresa = row.getCell(3).text; 
        const telefoneMaps = row.getCell(4).text;
        const endereco = row.getCell(7).text;
        const linkMaps = row.getCell(8).text;

        if (!nomeEmpresa) continue;

        process.stdout.write(`🔍 [${i-1}/${totalLinhas-1}] ${nomeEmpresa.substring(0, 15)}... `);

        let dadosFinais = {
            dono: "Responsável",
            cnpj: "N/A",
            tel_extra: "",
            email: "",
            capital: ""
        };

        try {
            // 1. BUSCA CNPJ NO BING
            const query = `"${nomeEmpresa}" CNPJ Belo Horizonte`;
            await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
            
            try { await page.waitForSelector('#b_results', { timeout: 2000 }); } catch(e) {}
            const textoPagina = await page.evaluate(() => document.body.innerText);
            const match = textoPagina.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
            
            if (match) {
                dadosFinais.cnpj = match[0];
                const cnpjLimpo = dadosFinais.cnpj.replace(/\D/g, '');
                
                // 2. CONSULTA DADOS COMPLETOS NA API
                let apiData = await consultarBrasilAPI(cnpjLimpo);
                if (!apiData) {
                    await delay(1000);
                    apiData = await consultarMinhaReceita(cnpjLimpo);
                }

                if (apiData) {
                    // a) Extrai Dono
                    if (apiData.qsa && apiData.qsa.length > 0) {
                        let socio = apiData.qsa[0].nome_socio || apiData.qsa[0].nome;
                        dadosFinais.dono = socio.toLowerCase().replace(/(^\w|\s\w)/g, m => m.toUpperCase());
                    }

                    // b) Extrai Telefone Extra (Ouro)
                    // Tenta pegar o telefone 2, se não tiver, pega o 1.
                    // Prioriza celular.
                    let t1 = apiData.ddd_telefone_1 || `${apiData.ddd_1}${apiData.telefone_1}`;
                    let t2 = apiData.ddd_telefone_2 || `${apiData.ddd_2}${apiData.telefone_2}`;
                    
                    // Limpa undefined
                    if (t1 && t1.includes('undefined')) t1 = "";
                    if (t2 && t2.includes('undefined')) t2 = "";

                    // Lógica: Se o Maps tem um fixo, queremos um celular daqui.
                    if (t2) dadosFinais.tel_extra = t2;
                    else if (t1 && t1 !== telefoneMaps.replace(/\D/g,'')) dadosFinais.tel_extra = t1;
                    
                    // Se o número extra for celular, adiciona ícone
                    if (dadosFinais.tel_extra && isCelular(dadosFinais.tel_extra)) {
                        dadosFinais.tel_extra += " 📱"; 
                    }

                    // c) Extrai Email e Capital
                    dadosFinais.email = apiData.email || "";
                    dadosFinais.capital = formatMoney(apiData.capital_social);

                    sucessos++;
                    console.log(`✅ CNPJ achado | 👤 ${dadosFinais.dono}`);
                } else {
                    console.log(`⚠️ CNPJ achado, mas API falhou`);
                }
            } else {
                console.log(`💨 CNPJ não achado`);
            }

        } catch (err) {
            console.log(`❌ Erro`);
        }

        // SALVA
        sheetSaida.addRow({
            nome: nomeEmpresa,
            tel_maps: telefoneMaps,
            dono: dadosFinais.dono,
            tel_extra: dadosFinais.tel_extra, // <--- Aqui vai o número novo
            email: dadosFinais.email,
            capital: dadosFinais.capital,
            cnpj: dadosFinais.cnpj,
            end: endereco,
            link: linkMaps
        });

        if (i % 5 === 0) await workbookSaida.xlsx.writeFile(ARQUIVO_SAIDA);
        
        // Delay aleatório
        const delayTime = Math.floor(Math.random() * 1500) + 1000;
        await new Promise(r => setTimeout(r, delayTime));
    }

    await workbookSaida.xlsx.writeFile(ARQUIVO_SAIDA);
    console.log(`\n🎉 ENRIQUECIMENTO PREMIUM CONCLUÍDO!`);
    console.log(`📂 Arquivo Final: ${ARQUIVO_SAIDA}`);
    console.log(`\nDica: Na coluna 'Telefone Extra', números com 📱 são celulares prováveis.`);
    
    await browser.close();
})();