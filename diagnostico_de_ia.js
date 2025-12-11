const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- COLOQUE SUA CHAVE AQUI ---
const API_KEY = "AIzaSyCkNzgMRAd72GekGlHxAIzd4eHtGVZ-8-k"; 
const genAI = new GoogleGenerativeAI(API_KEY);

const modelosParaTestar = [
    "gemini-1.5-flash",
    "gemini-1.5-flash-001",
    "gemini-1.5-flash-002",
    "gemini-1.5-pro",
    "gemini-1.0-pro"
];

async function testarModelos() {
    console.log("🏥 --- INICIANDO DIAGNÓSTICO --- 🏥\n");
    
    for (const nomeModelo of modelosParaTestar) {
        process.stdout.write(`Tentando conectar com: [ ${nomeModelo} ] ... `);
        try {
            const model = genAI.getGenerativeModel({ model: nomeModelo });
            // Tenta gerar um simples "Oi"
            await model.generateContent("Oi, você está vivo?");
            
            console.log("✅ SUCESSO! (Use este nome)");
            console.log(`\n🎉 O NOME VENCEDOR É: "${nomeModelo}"`);
            console.log("👉 Copie esse nome e coloque no seu código arena_de_teste.js e index.ultimate.js");
            return; // Para no primeiro que funcionar
        } catch (e) {
            console.log(`❌ Falhou (${e.status || 'Erro'})`);
        }
    }
    console.log("\n⚠️ Nenhum modelo funcionou. Verifique se sua API KEY está ativa no Google AI Studio.");
}

testarModelos();