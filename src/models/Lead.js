const mongoose = require('mongoose');

// Este é o "DNA" do seu Lead. 
// Unifica o Scraper (Passo 1), o Enrich (Passo 3) e o SDR (Passo Final).
const LeadSchema = new mongoose.Schema({
    // --- Dados da Mineração (Scraper) ---
    empresa_maps: { type: String, required: true },
    categoria: { type: String },
    telefone_maps: { type: String },
    endereco_completo: { type: String },
    link_maps: { type: String, unique: true }, // Evita duplicidade automaticamente!
    nota: { type: String },
    reviews: { type: Number },
    
    // --- Dados de Enriquecimento (BrasilAPI/Receita) ---
    cnpj: { type: String },
    razao_social: { type: String },
    nome_fantasia: { type: String },
    nome_socio: { type: String }, // O alvo do SDR
    telefone_socio: { type: String }, // O ouro da mina
    match_quality: { type: Number, default: 0 }, // % de certeza que achamos a empresa certa

    // --- Dados Geográficos (Para o Mapinha) ---
    location: {
        type: { type: String, default: 'Point' },
        coordinates: [Number] // [Longitude, Latitude]
    },

    // --- O Coração do CRM (Status do SDR) ---
    status: {
        type: String,
        enum: ['NOVO', 'ENRIQUECIDO', 'SDR_INICIADO', 'INTERESSADO', 'AGENDADO', 'DESCARTADO', 'ROBO'],
        default: 'NOVO'
    },

    // --- Logs de Auditoria ---
    historico_conversa: [{ 
        role: String, // 'assistant' ou 'user'
        content: String,
        timestamp: { type: Date, default: Date.now }
    }],
    
    data_criacao: { type: Date, default: Date.now },
    ultima_interacao: { type: Date }
});

// Índice para busca rápida no mapa (Geolocalização)
LeadSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Lead', LeadSchema);