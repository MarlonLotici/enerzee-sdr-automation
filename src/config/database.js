const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        // 👇 COLOQUE O LINK DO SEU MONGODB ATLAS AQUI DENTRO DAS ASPAS (Substitua a senha!)
        const dbURI = process.env.MONGO_URI || 'mongodb+srv://marlonlotici6_db_user:Mariza777@marlondatabase.spdh7mm.mongodb.net/?appName=Marlondatabase';

        // Configuração para evitar erros de depreciação (opcional em versões novas, mas seguro ter)
        await mongoose.connect(dbURI);

        console.log('✅ MongoDB Conectado! A "Caixa Preta" de dados está ativa na Nuvem.');
    } catch (err) {
        console.error('❌ Erro Crítico ao conectar no Banco:', err.message);
        // Encerra o processo se não conectar, para não rodar o resto bugado
        process.exit(1);
    }
};

module.exports = connectDB;