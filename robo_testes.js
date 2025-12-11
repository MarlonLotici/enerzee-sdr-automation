const Groq = require('groq-sdk');
const fs = require('fs'); 
require('dotenv').config();
const colors = require('colors'); 

// --- CONFIGURAÇÕES ---
const API_KEY = process.env.GROQ_API_KEY;
const groq = new Groq({ apiKey: API_KEY });

// Modelos Inteligentes
const MODELO_SDR = "llama-3.3-70b-versatile"; 
const MODELO_CLIENTE = "llama-3.3-70b-versatile"; 
const MODELO_JUIZ = "llama-3.3-70b-versatile"; 

// ==============================================================================
// 1. O CÉREBRO DO SDR (Baseado nas suas Regras V 6.0)
// ==============================================================================
const SYSTEM_PROMPT_SDR = `
IDENTIDADE:
Você é o "Assistente Especialista" da ENERZEE.
Produto: EZEE CONNECT (Energia por Assinatura).
Tom: Persuasivo, Executivo e Seguro. (Falando com lista fria).

CONTEXTO DO LEAD:
Nome: {{NOME_CLIENTE}}
Empresa: {{NOME_EMPRESA}}

--- 💎 TRATAMENTO VIP (GRUPO A / MERCADO LIVRE) ---
Se o cliente mencionar "Mercado Livre", "Grupo A" ou "Alta Tensão":
1. **NÃO DESQUALIFIQUE.**
2. **OFERTA:** Desconto maior: **ATÉ 30%**.
3. **ARGUMENTO:** "Para o seu perfil (Grupo A), temos uma modelagem exclusiva que chega a 30% de redução."

--- 🚫 FATORES DE DESQUALIFICAÇÃO (ENCERRE SE...) ---
1. **JÁ TEM BENEFÍCIO:** Solar, usina própria ou outro desconto.
   - *Resposta:* "Entendi! Como já possui compensação, não conseguimos sobrepor descontos. Parabéns!"
2. **OUTRA CONCESSIONÁRIA:** Se não for CEMIG.
   - *Resposta:* "Atuamos exclusivamente na área da CEMIG no momento."

--- 💡 O PRODUTO (ENCANTAMENTO) ---
1. **ZERO RISCO:** Sem obra, sem taxa de adesão.
2. **OS DESCONTOS:** GD (Até 25% Fidelidade / 15% Livre) ou Mercado Livre (Até 30%).

--- 🛡️ PROTOCOLOS DE BLINDAGEM ---
1. **CONTRATO/DOCS:** "Apresentamos a documentação na tela da reunião por segurança de dados."
2. **VISITA PRESENCIAL:** "Consultoria 100% online para agilidade."
3. **VALOR EM REAIS:** "Depende da classe de consumo. O Marlon calcula os centavos na reunião."

--- 🚀 FECHAMENTO (GATILHO IMEDIATO) ---
Se o cliente der sinal verde ("sim", "pode ser", "ok"):
**ENVIE O LINK DIRETO:** "Perfeito! Segue a agenda oficial do Marlon: 🔗 https://calendly.com/marlonlotici2/consultoria-energetica"

ENCERRAMENTO: Termine com PERGUNTA curta se não enviou o link.
`;

// ==============================================================================
// 2. CENÁRIOS DE TESTE (PERSONAS COMPLEXAS)
// ==============================================================================
const PERSONAS = [
    { 
        id: "VIP_MERCADO_LIVRE",
        nome: "Dr. Pedro (Indústria)", 
        empresa: "Indústria Metalúrgica",
        objetivo_esperado: "AGENDAR (VIP)",
        prompt: "Você é dono de uma indústria grande. Diga logo no início: 'Nós já operamos no Mercado Livre de Energia (Grupo A)'. Veja se o SDR te trata como VIP (30% desconto) ou se te dispensa. Se ele oferecer o desconto, você aceita a reunião." 
    },
    { 
        id: "DESQUALIFICADO_SOLAR",
        nome: "Fernando (Solar)", 
        empresa: "Casa de Carnes",
        objetivo_esperado: "ENCERRAR",
        prompt: "Você já tem energia solar. Diga: 'Já instalei placas ano passado, não pago nada'. O SDR deve encerrar educadamente. Se ele insistir, fique bravo." 
    },
    { 
        id: "GATEKEEPER_DIFICIL",
        nome: "Juliana (Secretária)", 
        empresa: "Construtora",
        objetivo_esperado: "AGENDAR (Com Dono)",
        prompt: "Você é secretária. Diga: 'O Sr. Marcos não atende vendas'. O SDR deve falar de 'Benefício Jurídico' ou 'Redução de Custo Fixo' para te convencer a passar o contato ou agendar." 
    },
    { 
        id: "OBJ_CONTRATO",
        nome: "Carlos (O Desconfiado)", 
        empresa: "Padaria Central",
        objetivo_esperado: "AGENDAR (Sem Doc)",
        prompt: "Você acha que é golpe. Diga: 'Me manda o contrato por email agora para eu ler'. O SDR deve negar (regra de segurança) e insistir na reunião. Se ele explicar bem, você aceita." 
    },
    { 
        id: "CLIENTE_FRIO_PADRAO",
        nome: "Ana (Loja de Roupas)", 
        empresa: "Ana Modas",
        objetivo_esperado: "AGENDAR",
        prompt: "Você é um lead frio. Atenda dizendo 'Quem é? O que você quer?'. O SDR tem que te encantar falando de economia sem investimento. Se fizer sentido, você topa." 
    }
];

// Variável global para montar o relatório
let relatorioMarkdown = `# 📊 RELATÓRIO FORENSE DE TESTE SDR (IA)
**Data:** ${new Date().toLocaleString()}
**Versão do Prompt:** 6.0 (Com VIP Grupo A e Lista Fria)

---
`;

// ==============================================================================
// 3. MOTOR DE SIMULAÇÃO
// ==============================================================================
async function rodarSimulacao() {
    console.log(`🚀 INICIANDO BATERIA DE TESTES (${PERSONAS.length} Cenários)...`.bgBlue.white);

    for (const clienteAtual of PERSONAS) {
        console.log(`\n▶️  TESTANDO: ${clienteAtual.nome}`.yellow.bold);
        
        // Configura o SDR com os dados do cliente atual
        const promptSDR = SYSTEM_PROMPT_SDR
            .replace('{{NOME_CLIENTE}}', clienteAtual.nome)
            .replace('{{NOME_EMPRESA}}', clienteAtual.empresa);

        let historySDR = [{ role: "system", content: promptSDR }];
        let historyCliente = [{ role: "system", content: clienteAtual.prompt }];
        let logConversa = []; // Para o relatório

        // 1. SDR Inicia (Abordagem Fria)
        let msgSDR = `Olá ${clienteAtual.nome}! Aqui é o Assistente da Enerzee. Identifiquei um perfil de alto consumo na ${clienteAtual.empresa}. Gostaria de avaliar uma redução de custo fixo sem investimento?`;
        
        console.log(`🔵 SDR: ${msgSDR}`.cyan);
        logConversa.push(`**SDR:** ${msgSDR}`);
        historySDR.push({ role: "assistant", content: msgSDR });
        historyCliente.push({ role: "user", content: msgSDR });

        // Loop de Conversa
        for (let turno = 1; turno <= 6; turno++) {
            // Cliente Responde
            const respCliente = await gerarResposta(historyCliente, MODELO_CLIENTE, 0.9);
            if (!respCliente) break;
            
            console.log(`🔴 CLIENTE: ${respCliente}`.red);
            logConversa.push(`**CLIENTE:** ${respCliente}`);
            historyCliente.push({ role: "assistant", content: respCliente });
            historySDR.push({ role: "user", content: respCliente });

            // Verifica Fim
            if (analisarFim(respCliente)) break;

            // SDR Responde
            const respSDR = await gerarResposta(historySDR, MODELO_SDR, 0.4);
            if (!respSDR) break;

            console.log(`🔵 SDR: ${respSDR}`.cyan);
            logConversa.push(`**SDR:** ${respSDR}`);
            historySDR.push({ role: "assistant", content: respSDR });
            historyCliente.push({ role: "user", content: respSDR });
        }

        // Avaliação do Juiz
        await avaliarDesempenho(clienteAtual, logConversa);
        
        // Pausa de segurança
        await new Promise(r => setTimeout(r, 2000));
    }

    // Salvar Arquivo Final
    fs.writeFileSync('RELATORIO_DETALHADO.md', relatorioMarkdown);
    console.log(`\n✅ TESTES FINALIZADOS!`.bgGreen.black);
    console.log(`📄 Relatório rico gerado em: RELATORIO_DETALHADO.md`.white.bold);
    console.log(`(Copie o conteúdo deste arquivo e cole no chat para análise)`.gray);
}

// ==============================================================================
// 4. FUNÇÕES AUXILIARES
// ==============================================================================
async function gerarResposta(messages, model, temp) {
    try {
        const completion = await groq.chat.completions.create({
            messages: messages, model: model, temperature: temp, max_tokens: 300
        });
        return completion.choices[0]?.message?.content || "...";
    } catch (e) { return null; }
}

function analisarFim(texto) {
    const t = texto.toLowerCase();
    if (t.includes("agendar") || t.includes("link") || t.includes("tchau") || t.includes("não quero")) return true;
    return false;
}

// --- O JUIZ SUPREMO ---
async function avaliarDesempenho(persona, logArray) {
    const transcript = logArray.join("\n");
    
    const promptJuiz = `
    Analise esta conversa de vendas.
    
    CENÁRIO: ${persona.nome}
    OBJETIVO ESPERADO: ${persona.objetivo_esperado}
    
    REGRAS DE SUCESSO:
    1. Se era "VIP_MERCADO_LIVRE", o SDR ofereceu 30% e tentou agendar? (Não pode desqualificar).
    2. Se era "DESQUALIFICADO", o SDR encerrou educadamente?
    3. Se era "OBJ_CONTRATO", o SDR negou envio por email?
    4. O SDR enviou o link do Calendly no momento certo?

    CONVERSA:
    ${transcript}

    Retorne JSON estrito:
    {
        "nota": 0-100,
        "status": "SUCESSO" ou "FALHA",
        "analise_critica": "Explicação detalhada em 1 frase",
        "ponto_melhoria": "O que ajustar no prompt"
    }
    `;

    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: promptJuiz }],
            model: MODELO_JUIZ, temperature: 0.1, response_format: { type: "json_object" }
        });
        
        const res = JSON.parse(completion.choices[0]?.message?.content);
        
        // Adicionar ao Relatório Markdown
        relatorioMarkdown += `
## 👤 Persona: ${persona.nome}
**Cenário:** ${persona.id}
**Resultado:** ${res.status == 'SUCESSO' ? '✅ SUCESSO' : '❌ FALHA'} (Nota: ${res.nota})

> **Análise da IA:** ${res.analise_critica}

**Sugestão:** ${res.ponto_melhoria}

<details>
<summary>📄 Ver Conversa Completa</summary>

${transcript}

</details>
\n---\n`;

        console.log(`   ↳ Resultado: ${res.status} (${res.nota})`.gray);

    } catch (e) { console.error("Erro no Juiz:", e); }
}

rodarSimulacao();