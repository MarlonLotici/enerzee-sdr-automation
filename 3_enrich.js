const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const ExcelJS = require('exceljs');
const fs = require('fs');
const https = require('https');
const stringSimilarity = require('string-similarity');

puppeteer.use(StealthPlugin());

// CONFIGURAÇÃO
const ARQUIVO_ENTRADA = 'leads_prontos_para_enrich.xlsx'; 
const ARQUIVO_SAIDA = 'LEADS_PREMIUM_FINAL.xlsx';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Função de API (BrasilAPI)
async function consultarBrasilAPI(cnpj) {
    return new Promise((resolve) => {
        const req = https.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                } else resolve(null);
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    });
}

(async () => {
    console.log(`💎 INICIANDO ENRIQUECIMENTO DE ELITE (FIM DO UNDEFINED)...`);

    const workbookEntrada = new ExcelJS.Workbook();
    
    try {
        await workbookEntrada.xlsx.readFile(ARQUIVO_ENTRADA);
    } catch (e) {
        console.log(`❌ Erro ao abrir ${ARQUIVO_ENTRADA}. Verifique se ele existe e não está aberto.`);
        process.exit(1);
    }
    
    const sheetEntrada = workbookEntrada.getWorksheet(1);
    const workbookSaida = new ExcelJS.Workbook();
    const sheetSaida = workbookSaida.addWorksheet('Leads Premium');
    
    // Cabeçalhos (Fidelizados ao seu Excel de Saída)
    sheetSaida.columns = [
        { header: 'Empresa (Maps)', key: 'nome_maps', width: 30 },
        { header: 'Empresa (Receita)', key: 'nome_receita', width: 30 },
        { header: 'Match %', key: 'match', width: 10 },
        { header: 'Dono', key: 'dono', width: 30 },
        { header: 'Celular Sócio', key: 'celular_socio', width: 18 },
        { header: 'Telefone Maps', key: 'tel_maps', width: 15 },
        { header: 'CNPJ', key: 'cnpj', width: 18 },
        { header: 'Endereço', key: 'end', width: 30 }
    ];

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    const rows = [];
    sheetEntrada.eachRow((row, number) => { if (number > 1) rows.push(row); });

    console.log(`📊 Processando ${rows.length} empresas...`);

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const nomeMaps = row.getCell(3).text; 
        const telefoneMaps = row.getCell(4).text;
        const enderecoCompleto = row.getCell(7).text;
        
        process.stdout.write(`🔍 [${i+1}/${rows.length}] ${nomeMaps.substring(0, 15)}... `);

        let dados = { 
            nome_receita: "N/A", match: 0, dono: "Responsável", 
            cnpj: "", celular_socio: "", capital: "" 
        };

        try {
            // --- ESTRATÉGIA DE BUSCA INTELIGENTE (ENDEREÇO) ---
            const partesEnd = enderecoCompleto.split(/[,-]/);
            const rua = partesEnd[0] ? partesEnd[0].trim() : "Cuiabá";
            const numeroMatch = enderecoCompleto.match(/,\s*(\d+)/);
            const numero = numeroMatch ? numeroMatch[1] : "";

            // Query: Nome + Rua + CNPJ
            let query = `"${nomeMaps}" ${rua} ${numero} CNPJ`;

            // Navega no Bing
            await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
            let content = await page.evaluate(() => document.body.innerText);
            let cnpjMatch = content.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);

            if (!cnpjMatch) {
                // Fallback: Nome limpo + Cuiabá
                const nomeLimpo = nomeMaps.replace(/LTDA|S\.A\.|ME\s|EPP/gi, '').trim();
                const queryBackup = `${nomeLimpo} Cuiabá CNPJ`;
                await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(queryBackup)}`, { waitUntil: 'domcontentloaded' });
                content = await page.evaluate(() => document.body.innerText);
                cnpjMatch = content.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
            }

            if (cnpjMatch) {
                const cnpjLimpo = cnpjMatch[0].replace(/\D/g, '');
                const apiData = await consultarBrasilAPI(cnpjLimpo);

                if (apiData) {
                    const razao = apiData.razao_social || "";
                    const fantasia = apiData.nome_fantasia || "";
                    
                    const scoreRazao = stringSimilarity.compareTwoStrings(nomeMaps.toUpperCase(), razao.toUpperCase());
                    const scoreFantasia = stringSimilarity.compareTwoStrings(nomeMaps.toUpperCase(), fantasia.toUpperCase());
                    const melhorMatch = Math.max(scoreRazao, scoreFantasia);
                    
                    dados.match = (melhorMatch * 100).toFixed(0);
                    dados.nome_receita = fantasia || razao;
                    dados.cnpj = cnpjMatch[0];

                    // Extração de Sócio
                    if (apiData.qsa && apiData.qsa.length > 0) {
                        const socioAdm = apiData.qsa.find(s => s.qualificacao_socio_administrador) || apiData.qsa[0];
                        dados.dono = socioAdm.nome_socio || socioAdm.nome;
                        dados.dono = dados.dono.toLowerCase().replace(/(^\w|\s\w)/g, m => m.toUpperCase());
                    }

                    // 🔥 CORREÇÃO CRÍTICA DO UNDEFINED 🔥
                    const ddd1 = apiData.ddd_telefone_1;
                    const tel1 = apiData.telefone_1;
                    const ddd2 = apiData.ddd_telefone_2;
                    const tel2 = apiData.telefone_2;

                    // Função para validar se é celular (começa com 9)
                    const formatarCel = (ddd, num) => {
                        if (!ddd || !num) return null;
                        if (num.length === 9 || (num.length === 8 && num.startsWith('9'))) {
                            return `${ddd}${num}`;
                        }
                        // Se for fixo, também serve, mas preferimos celular
                        return `${ddd}${num}`; 
                    };

                    const celularEncontrado = formatarCel(ddd1, tel1) || formatarCel(ddd2, tel2);
                    
                    if (celularEncontrado) {
                        dados.celular_socio = celularEncontrado;
                    }

                    console.log(`✅ Achou! (${dados.match}%) | ${dados.dono} | Cel: ${dados.celular_socio}`);
                }
            } else {
                console.log(`💨 CNPJ não achado.`);
            }

        } catch (e) { console.log(`❌ Erro busca.`); }

        sheetSaida.addRow({
            nome_maps: nomeMaps,
            nome_receita: dados.nome_receita,
            match: dados.match + '%',
            dono: dados.dono,
            celular_socio: dados.celular_socio,
            tel_maps: telefoneMaps,
            cnpj: dados.cnpj,
            end: enderecoCompleto
        });

        if (i % 10 === 0) await workbookSaida.xlsx.writeFile(ARQUIVO_SAIDA);
        await delay(300); 
    }

    await workbookSaida.xlsx.writeFile(ARQUIVO_SAIDA);
    await browser.close();
    console.log(`🏁 FIM!`);
})();