// TESTE DE INTELIGÊNCIA DO SEU SDR
const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODELO = "llama-3.3-70b-versatile";

// COPIE SEU TEMPLATE COMPLETO AQUI
const SDR_TEMPLATE = `
[COLE AQUI SEU TEMPLATE COMPLETO DO index.js]
`;

async function testarInteligencia(cenario, perguntaCliente) {
    console.log(`\n🧠 TESTE: ${cenario}`);
    console.log(`👤 Cliente: "${perguntaCliente}"`);
    
    const promptPersonalizado = SDR_TEMPLATE
        .replace(/{{NOME_CLIENTE}}/g, "Carlos")
        .replace(/{{NOME_EMPRESA}}/g, "Padaria Pão Quente");
    
    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: "system", content: promptPersonalizado },
                { role: "user", content: perguntaCliente }
            ],
            model: MODELO,
            temperature: 0.5,
            max_tokens: 300
        });
        
        const resposta = response.choices[0]?.message?.content;
        console.log(`🤖 SDR: "${resposta}"`);
        
        // Análise
        console.log(`\n📊 ANÁLISE:`);
        
        const analise = {
            seguiuRegras: true,
            problemas: [],
            pontosFortes: []
        };
        
        // Verificar regras críticas
        if (resposta.toLowerCase().includes('r$') || 
            resposta.match(/\d+[.,]\d+\s*(reais|real|r\$)/i)) {
            analise.seguiuRegras = false;
            analise.problemas.push('❌ Deu valor em reais');
        }
        
        if (resposta.toLowerCase().includes('visita') || 
            resposta.toLowerCase().includes('presencial')) {
            analise.seguiuRegras = false;
            analise.problemas.push('❌ Ofereceu presencial');
        }
        
        if (resposta.toLowerCase().includes('enviar') && 
            (resposta.toLowerCase().includes('contrato') || 
             resposta.toLowerCase().includes('pdf') || 
             resposta.toLowerCase().includes('documento'))) {
            analise.seguiuRegras = false;
            analise.problemas.push('❌ Prometeu enviar documento');
        }
        
        // Pontos fortes
        if (resposta.toLowerCase().includes('online') || 
            resposta.toLowerCase().includes('vídeo') || 
            resposta.toLowerCase().includes('virtual')) {
            analise.pontosFortes.push('✅ Manteve reunião online');
        }
        
        if (resposta.toLowerCase().includes('agendar') || 
            resposta.toLowerCase().includes('reunião')) {
            analise.pontosFortes.push('✅ Focou em agendamento');
        }
        
        if (resposta.toLowerCase().includes('maria') || 
            resposta.toLowerCase().includes('carlos')) {
            analise.pontosFortes.push('✅ Usou nome do cliente');
        }
        
        // Resultado
        console.log(analise.seguiuRegras ? '✅ SEGUIU AS REGRAS' : '❌ VIOLOU REGRAS');
        analise.problemas.forEach(p => console.log(p));
        analise.pontosFortes.forEach(p => console.log(p));
        
        return analise;
        
    } catch (error) {
        console.log(`❌ Erro: ${error.message}`);
        return null;
    }
}

// EXECUTAR TESTES
async function executarTestes() {
    const testes = [
        {
            cenario: "Cliente quer valor em reais",
            pergunta: "Quanto vou economizar em dinheiro? Me fala o valor exato."
        },
        {
            cenario: "Cliente desconfiado", 
            pergunta: "Isso é golpe? Como posso confiar?"
        },
        {
            cenario: "Cliente quer visita",
            pergunta: "Preciso que alguém venha aqui na empresa explicar"
        },
        {
            cenario: "Cliente quer documento",
            pergunta: "Me manda o contrato por email antes"
        },
        {
            cenario: "Cliente apressado",
            pergunta: "Tô ocupado. Fala quanto é e se vale a pena"
        }
    ];
    
    console.log('🚀 TESTANDO INTELIGÊNCIA DO SEU SDR\n');
    
    for (const teste of testes) {
        await testarInteligencia(teste.cenario, teste.pergunta);
        console.log('\n' + '─'.repeat(60));
        await new Promise(resolve => setTimeout(resolve, 2000)); // Pausa
    }
}

executarTestes().catch(console.error);