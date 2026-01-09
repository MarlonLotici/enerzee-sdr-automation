const fs = require('fs');
const readline = require('readline');
const ExcelJS = require('exceljs');

// --- ⚙️ CONFIGURAÇÃO ---
// ATENÇÃO: O nome abaixo deve ser IDÊNTICO ao gerado no 1_scraper.js
const ARQUIVO_ENTRADA = 'leads_cuiaba_TOTAL_EXCLUSIVO.csv'; 

// Este nome é o que o 3_enrich.js espera receber. Não mude.
const ARQUIVO_SAIDA = 'leads_prontos_para_enrich.xlsx'; 

// CRITÉRIOS DE QUALIDADE
const MINIMO_AVALIACOES = 5; // Filtro leve para captar PMEs em crescimento

const PALAVRAS_PROIBIDAS = [
    'Condominio', 'Edificio', 'Residencial', 'Apartamento', 
    'Prefeitura', 'Secretaria', 'Escola Estadual', 'Escola Municipal', 
    'Igreja', 'Templo', 'Associacao', 'Clube'
];

(async () => {
    console.log(`🧹 INICIANDO FAXINA E CONVERSÃO...`);
    console.log(`📂 Lendo: ${ARQUIVO_ENTRADA}`);

    if (!fs.existsSync(ARQUIVO_ENTRADA)) {
        console.error(`❌ ERRO FATAL: O arquivo '${ARQUIVO_ENTRADA}' não existe.`);
        console.error(`👉 Verifique se o nome no 1_scraper.js é exatamente este.`);
        process.exit(1);
    }

    const fileStream = fs.createReadStream(ARQUIVO_ENTRADA);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    // Preparando o Excel de Saída
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Leads Limpos');

    // Cabeçalho do Excel
    worksheet.columns = [
        { header: 'Cluster', key: 'cluster', width: 20 },
        { header: 'Categoria', key: 'cat', width: 20 },
        { header: 'Nome', key: 'nome', width: 35 },
        { header: 'Telefone', key: 'tel', width: 15 },
        { header: 'Nota', key: 'nota', width: 10 },
        { header: 'Reviews', key: 'rev', width: 10 },
        { header: 'Endereço', key: 'end', width: 40 },
        { header: 'Link', key: 'link', width: 10 }
    ];

    const telefonesVistos = new Set();
    const linksVistos = new Set();
    
    let stats = { lidos: 0, salvos: 0, duplicados: 0, fantasmas: 0, proibidos: 0 };

    for await (const line of rl) {
        stats.lidos++;
        if (stats.lidos === 1 || !line.trim()) continue; // Pula cabeçalho CSV ou vazios

        const colunas = line.split(';');
        if (colunas.length < 4) continue;

        const [cluster, categoria, nome, telefone, notaStr, reviewsStr, endereco, link] = colunas;

        // --- FILTRO 1: DUPLICIDADE ---
        const telLimpo = telefone.replace(/\D/g, '');
        if (telefonesVistos.has(telLimpo) || linksVistos.has(link)) {
            stats.duplicados++;
            continue;
        }

        // --- FILTRO 2: FANTASMAS ---
        const reviews = parseInt(reviewsStr ? reviewsStr.replace('.', '') : '0') || 0;
        if (reviews < MINIMO_AVALIACOES) {
            stats.fantasmas++;
            continue;
        }

        // --- FILTRO 3: BLACKLIST ---
        if (PALAVRAS_PROIBIDAS.some(p => nome.toUpperCase().includes(p.toUpperCase()))) {
            stats.proibidos++;
            continue;
        }

        // ✅ APROVADO: Adiciona ao Excel
        telefonesVistos.add(telLimpo);
        linksVistos.add(link);
        
        worksheet.addRow({
            cluster: cluster,
            cat: categoria,
            nome: nome,
            tel: telefone,
            nota: notaStr,
            rev: reviews,
            end: endereco,
            link: link
        });
        
        stats.salvos++;
    }

    // Salva o arquivo XLSX final para o próximo script
    await workbook.xlsx.writeFile(ARQUIVO_SAIDA);

    console.log(`\n✅ CONVERSÃO CONCLUÍDA!`);
    console.log(`📊 Estatísticas:`);
    console.log(`   - Lidos: ${stats.lidos}`);
    console.log(`   - Duplicados: -${stats.duplicados}`);
    console.log(`   - Irrelevantes: -${stats.fantasmas + stats.proibidos}`);
    console.log(`   💎 LEADS VÁLIDOS: ${stats.salvos}`);
    console.log(`💾 Arquivo Gerado: ${ARQUIVO_SAIDA}`);
    console.log(`👉 Pronto para o Script 3_enrich.js!`);

})();