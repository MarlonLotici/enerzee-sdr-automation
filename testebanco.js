const connectDB = require('./src/config/database');
const Lead = require('./src/models/Lead');

(async () => {
    await connectDB();

    console.log("🧪 Criando um Lead de Teste...");
    
    try {
        const novoLead = await Lead.create({
            empresa_maps: "Padaria do Teste 2", // Mudei o nome para não dar duplicidade
            categoria: "Padaria",
            link_maps: "http://googleusercontent.com/maps.google.com/teste_gps",
            status: "NOVO",
            // 👇 AQUI ESTÁ A CORREÇÃO: Demos um endereço de GPS (Cuiabá) para ele
            location: {
                type: 'Point',
                coordinates: [-56.097892, -15.601411] // Longitude, Latitude
            }
        });

        console.log("🎉 SUCESSO TOTAL! O Lead foi salvo no Banco de Dados:");
        console.log(novoLead);
    } catch (e) {
        if (e.code === 11000) console.log("⚠️ Lead já existe (Teste de duplicidade funcionou!)");
        else console.error(e);
    }

    process.exit(0);
})();