require('dotenv').config();
const { iniciarVarredura } = require('./1_scraper');

const leads = [];
const startTime = Date.now();

async function test() {
    console.log('\n🚀 TESTE DO SCRAPER V3 — GRID DE COORDENADAS');
    console.log('==============================================\n');

    // Teste 1: Busca por cidade
    await iniciarVarredura(
        {
            city: 'Florianópolis',
            niche: 'padaria',
            mode: 'city',
            // lat e lng são opcionais no modo cidade
        },
        async (progress) => {
            if (progress.type === 'lead') {
                leads.push(progress.data);
                if (leads.length % 20 === 0) {
                    console.log(`\n📈 Progresso: ${leads.length} leads | ${Math.round((Date.now() - startTime)/1000)}s\n`);
                }
            } else if (progress.type === 'status') {
                console.log(`\n📢 ${progress.message}\n`);
            } else if (progress.type === 'progress') {
                // Barra de progresso
            }
        },
        () => {
            // Timeout de 10 minutos pro teste
            const elapsed = (Date.now() - startTime) / 1000;
            if (elapsed > 600) {
                console.log('\n⏰ Timeout de 10 minutos atingido');
                return true;
            }
            return false;
        }
    );

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log('\n\n========================================');
    console.log('📊 RESULTADO DO TESTE');
    console.log('========================================');
    console.log(`Total: ${leads.length} leads`);
    console.log(`Tempo: ${elapsed}s (${(elapsed/60).toFixed(1)}min)`);
    console.log(`Velocidade: ${(leads.length / (elapsed / 60)).toFixed(1)} leads/min`);
    console.log('========================================');

    // Amostra
    console.log('\n📋 Amostra (5 primeiros):');
    leads.slice(0, 5).forEach((l, i) => {
        console.log(`  ${i+1}. ${l.name} | ${l.phone} | ⭐${l.rating || '?'} | 📍${l.bairro || '?'}`);
    });

    // Salva
    const fs = require('fs');
    fs.writeFileSync('test_results_v3.json', JSON.stringify(leads, null, 2));
    console.log('\n💾 Salvos em test_results_v3.json');

    // Análise de cobertura por bairro
    const bairros = {};
    leads.forEach(l => {
        const b = l.bairro || 'Desconhecido';
        bairros[b] = (bairros[b] || 0) + 1;
    });
    console.log('\n📍 Cobertura por bairro:');
    Object.entries(bairros).sort((a,b) => b[1] - a[1]).forEach(([b, c]) => {
        console.log(`  ${b}: ${c} leads`);
    });
}

test().catch(console.error);