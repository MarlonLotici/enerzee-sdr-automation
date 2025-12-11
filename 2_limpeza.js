const fs = require('fs');
const readline = require('readline');

// CONFIGURAÇÃO
const ARQUIVO_ENTRADA = 'leads_bh_massivo.csv'; // O arquivo sujo que saiu do Scraper
const ARQUIVO_SAIDA = 'leads_prontos_para_enrich.csv'; // O arquivo limpo

// CRITÉRIOS DE CORTE (Ajuste conforme sua régua de qualidade)
const MINIMO_AVALIACOES = 15; // Menos que isso = provável empresa fantasma ou muito pequena
const NOTA_MINIMA = 3.0; // Opcional: filtrar empresas muito mal avaliadas

// BLACKLIST: Palavras que, se estiverem no nome, a gente EXCLUI.
// Adicione aqui tipos de clientes que você NÃO quer (ex: Governo, Residencial, etc)
const PALAVRAS_PROIBIDAS = [
    'Condominio', 
    'Edificio', 
    'Residencial', 
    'Apartamento', 
    'Prefeitura', 
    'Secretaria',
    'Escola Estadual',
    'Escola Municipal',
    'Associacao',
    'Igreja', // Se não for seu foco
    'Clube'
];

(async () => {
    console.log(`🧹 INICIANDO FAXINA NO ARQUIVO: ${ARQUIVO_ENTRADA}...\n`);

    if (!fs.existsSync(ARQUIVO_ENTRADA)) {
        console.error(`❌ Erro: Não achei o arquivo ${ARQUIVO_ENTRADA}`);
        return;
    }

    const fileStream = fs.createReadStream(ARQUIVO_ENTRADA);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const telefonesVistos = new Set();
    const linksVistos = new Set();
    let totalLidos = 0;
    let totalSalvos = 0;
    let duplicados = 0;
    let fantasmas = 0;
    let proibidos = 0;

    // Prepara arquivo de saída com cabeçalho (assumindo o padrão do scraper anterior)
    // Cluster;Categoria;Nome;Telefone;Nota;Avaliacoes;Endereco;Link
    const header = 'Cluster;Categoria;Nome;Telefone;Nota;Avaliacoes;Endereco;Link\n';
    fs.writeFileSync(ARQUIVO_SAIDA, '\uFEFF' + header);

    for await (const line of rl) {
        totalLidos++;

        // Pula cabeçalho ou linhas vazias
        if (totalLidos === 1 || !line.trim()) continue;

        const colunas = line.split(';');
        
        // Verifica se a linha tem os dados mínimos (pelo menos até o telefone)
        if (colunas.length < 4) continue;

        const [cluster, categoria, nome, telefone, notaStr, reviewsStr, endereco, link] = colunas;

        // --- FILTRO 1: DUPLICIDADE (Pelo Telefone ou Link) ---
        // Limpa o telefone para comparar apenas números
        const telLimpo = telefone.replace(/\D/g, '');
        if (telefonesVistos.has(telLimpo) || linksVistos.has(link)) {
            duplicados++;
            continue; // Pula essa linha
        }

        // --- FILTRO 2: EMPRESAS "FANTASMAS" (Poucas avaliações) ---
        // Converte "1.030" para 1030 e "50" para 50
        const reviews = parseInt(reviewsStr.replace('.', '')) || 0;
        const nota = parseFloat(notaStr.replace(',', '.')) || 0;

        if (reviews < MINIMO_AVALIACOES) {
            fantasmas++;
            continue; 
        }

        // --- FILTRO 3: BLACKLIST (Palavras Proibidas) ---
        const nomeUpper = nome.toUpperCase();
        const ehProibido = PALAVRAS_PROIBIDAS.some(palavra => nomeUpper.includes(palavra.toUpperCase()));
        
        if (ehProibido) {
            proibidos++;
            continue;
        }

        // --- SE PASSOU POR TUDO: SALVA E MARCA COMO VISTO ---
        telefonesVistos.add(telLimpo);
        linksVistos.add(link);
        
        fs.appendFileSync(ARQUIVO_SAIDA, line + '\n');
        totalSalvos++;
    }

    console.log(`✅ PROCESSO FINALIZADO!`);
    console.log(`-----------------------------------`);
    console.log(`📄 Linhas lidas:      ${totalLidos}`);
    console.log(`🚫 Duplicados:        -${duplicados}`);
    console.log(`👻 "Fantasmas":       -${fantasmas} (Menos de ${MINIMO_AVALIACOES} avaliações)`);
    console.log(`⛔ Blacklist:         -${proibidos} (Nomes proibidos)`);
    console.log(`-----------------------------------`);
    console.log(`💎 LEADS VÁLIDOS:     ${totalSalvos}`);
    console.log(`💾 Salvo em:          ${ARQUIVO_SAIDA}`);
})();