const { spawn } = require('child_process');
const path = require('path');

// Função para dar cor ao terminal
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m"
};

console.log(colors.cyan + `
    ███    ███  █████  ██ ███    ██
    ████  ████ ██   ██ ██ ████   ██
    ██ ████ ██ ███████ ██ ██ ██  ██
    ██  ██  ██ ██   ██ ██ ██  ██ ██
    ██      ██ ██   ██ ██ ██   ████
` + colors.reset);

console.log(colors.bright + `🔥 MOTOR DE DADOS AUTOMATIZADO V2.0 (CORRIGIDO) 🔥` + colors.reset);
console.log(`📅 Data: ${new Date().toLocaleString()}\n`);

// LISTA DE PROCESSOS COM OS NOMES CORRETOS DA SUA PASTA
const steps = [
    { 
        file: '1_scraper.js', 
        description: 'ETAPA 1/3 - MINERAÇÃO (SCRAPER)' 
    },
    { 
        file: '2_clean.js', // Corrigido de '2_limpeza.js'
        description: 'ETAPA 2/3 - HIGIENIZAÇÃO (CLEAN)' 
    },
    { 
        file: '3_enrich.js', // Corrigido de '3_enriquecimento.js'
        description: 'ETAPA 3/3 - ENRIQUECIMENTO (IA)' 
    }
    // O 4_sdr.js geralmente roda separado via server.js, mas se quiser na sequencia, adicione aqui.
];

async function runStep(index) {
    if (index >= steps.length) {
        console.log(colors.green + "\n====================================================");
        console.log("✅ CICLO COMPLETO FINALIZADO COM SUCESSO!");
        console.log("====================================================" + colors.reset);
        process.exit(0);
    }

    const step = steps[index];
    console.log(colors.yellow + "====================================================");
    console.log(`🚀 INICIANDO ${step.description}`);
    console.log("====================================================" + colors.reset);

    // Ajuste técnico: Usa o executável 'node' explicitamente para evitar erros de shell
    const child = spawn('node', [step.file], { 
        stdio: 'inherit',
        shell: false // Correção do Warning de segurança
    });

    child.on('error', (err) => {
        console.error(colors.red + `❌ ERRO AO INICIAR ${step.file}: ${err.message}` + colors.reset);
    });

    child.on('close', (code) => {
        if (code === 0) {
            console.log(colors.green + `✅ ${step.file} CONCLUÍDO.\n` + colors.reset);
            runStep(index + 1); // Chama o próximo
        } else {
            console.error(colors.red + `❌ ERRO FATAL: ${step.file} encerrou com código ${code}.` + colors.reset);
            console.error(colors.red + `💀 O PROCESSO FOI ABORTADO.` + colors.reset);
            process.exit(code);
        }
    });
}

// Verifica se os arquivos existem antes de começar
const fs = require('fs');
let arquivosFaltando = false;

steps.forEach(step => {
    if (!fs.existsSync(path.join(__dirname, step.file))) {
        console.error(colors.red + `❌ ARQUIVO NÃO ENCONTRADO: ${step.file}` + colors.reset);
        arquivosFaltando = true;
    }
});

if (arquivosFaltando) {
    console.log("Verifique os nomes dos arquivos na pasta e tente novamente.");
    process.exit(1);
} else {
    runStep(0);
}