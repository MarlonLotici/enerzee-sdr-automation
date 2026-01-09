const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// --- CONFIGURAÇÃO VISUAL ---
const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    red: "\x1b[31m",
    cyan: "\x1b[36m"
};

// Função auxiliar para rodar scripts como processos filhos
function rodarScript(nomeArquivo, etapa) {
    return new Promise((resolve, reject) => {
        // Verifica se o arquivo existe usando o caminho completo
        const caminhoCompleto = path.join(__dirname, nomeArquivo);
        
        if (!fs.existsSync(caminhoCompleto)) {
            console.error(`${COLORS.red}❌ ERRO FATAL: Arquivo '${nomeArquivo}' não encontrado na pasta:${COLORS.reset}`);
            console.error(`${caminhoCompleto}`);
            reject(new Error('Arquivo não encontrado'));
            return;
        }

        console.log(`\n${COLORS.cyan}====================================================${COLORS.reset}`);
        console.log(`${COLORS.bright}🚀 INICIANDO ETAPA ${etapa}: ${nomeArquivo.toUpperCase()}${COLORS.reset}`);
        console.log(`${COLORS.cyan}====================================================${COLORS.reset}\n`);

        // --- CORREÇÃO AQUI ---
        // cwd: __dirname -> Força o comando a rodar DENTRO da pasta atual.
        // Assim, passamos apenas "1_scraper.js" (sem espaços) em vez do caminho completo.
        const processo = spawn('node', [nomeArquivo], { 
            stdio: 'inherit', 
            shell: true,
            cwd: __dirname 
        });

        processo.on('close', (code) => {
            if (code === 0) {
                console.log(`\n${COLORS.green}✅ ETAPA ${etapa} CONCLUÍDA COM SUCESSO!${COLORS.reset}`);
                resolve();
            } else {
                console.error(`\n${COLORS.red}❌ ETAPA ${etapa} FALHOU (Código ${code}). Processo interrompido.${COLORS.reset}`);
                reject(new Error(`Script ${nomeArquivo} falhou`));
            }
        });

        processo.on('error', (err) => {
            console.error(`${COLORS.red}❌ Erro ao tentar iniciar o script: ${err.message}${COLORS.reset}`);
            reject(err);
        });
    });
}

// --- FUNÇÃO PRINCIPAL ---
(async () => {
    const inicioTotal = Date.now();

    console.log(`${COLORS.yellow}
    ███    ███  █████  ██ ███    ██ 
    ████  ████ ██   ██ ██ ████   ██ 
    ██ ████ ██ ███████ ██ ██ ██  ██ 
    ██  ██  ██ ██   ██ ██ ██  ██ ██ 
    ██      ██ ██   ██ ██ ██   ████ 
    ${COLORS.reset}`);
    console.log(`${COLORS.bright}🔥 MOTOR DE DADOS AUTOMATIZADO V1.0 🔥${COLORS.reset}`);
    console.log(`📅 Data: ${new Date().toLocaleString()}`);

    try {
        // 1. RODAR SCRAPER
        await rodarScript('1_scraper.js', '1/3 - MINERAÇÃO (SCRAPER)');

        // Delay de segurança
        await new Promise(r => setTimeout(r, 2000));

        // 2. RODAR LIMPEZA
        await rodarScript('2_limpeza.js', '2/3 - HIGIENIZAÇÃO (CLEANER)');

        await new Promise(r => setTimeout(r, 2000));

        // 3. RODAR ENRIQUECIMENTO
        await rodarScript('3_enrich.js', '3/3 - ENRIQUECIMENTO (PREMIUM DATA)');

        // --- VERIFICAÇÃO FINAL ---
        const fimTotal = Date.now();
        const tempoTotal = ((fimTotal - inicioTotal) / 1000 / 60).toFixed(2);
        const arquivoFinal = 'LEADS_PREMIUM_FINAL.xlsx';

        if (fs.existsSync(path.join(__dirname, arquivoFinal))) {
            // Tenta tocar som
            try { exec('powershell [System.Media.SystemSounds]::Beep.Play()'); } catch(e) {}

            console.log(`\n${COLORS.green}
    🏆🏆🏆 OPERAÇÃO COMPLETA COM SUCESSO! 🏆🏆🏆
            ${COLORS.reset}`);
            console.log(`${COLORS.bright}⏱️  Tempo Total de Execução: ${tempoTotal} minutos${COLORS.reset}`);
            console.log(`${COLORS.bright}📂 Arquivo Final: ${arquivoFinal}${COLORS.reset}`);
            console.log(`${COLORS.blue}🔔 SINAL SONORO EMITIDO. HORA DE LER O QR CODE!${COLORS.reset}`);
        } else {
            console.log(`\n${COLORS.red}⚠️  ALERTA: Processo finalizado, mas '${arquivoFinal}' não foi encontrado.${COLORS.reset}`);
        }

    } catch (erro) {
        console.error(`\n${COLORS.red}💀 O PROCESSO FOI ABORTADO DEVIDO A UM ERRO CRÍTICO.${COLORS.reset}`);
        try { exec('powershell [System.Media.SystemSounds]::Hand.Play()'); } catch(e) {}
    }
})();