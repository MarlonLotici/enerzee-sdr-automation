const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Caminho do arquivo do banco
const dbPath = path.resolve(__dirname, 'leads.db');

let db;

// Função Auxiliar para verificar e adicionar colunas faltantes
async function migrate(database) {
    const requiredColumns = [
        { name: 'nome', type: 'TEXT' },
        { name: 'capital_social', type: 'TEXT' },
        { name: 'cnae', type: 'TEXT' },
        { name: 'instagram', type: 'TEXT' },
        { name: 'facebook', type: 'TEXT' },
        { name: 'socios', type: 'TEXT' },
        { name: 'dono', type: 'TEXT' },
        { name: 'celular_socio', type: 'TEXT' },
        { name: 'lat', type: 'REAL' },
        { name: 'lng', type: 'REAL' },
        { name: 'data_atualizacao', type: 'TEXT' },
        { name: 'whatsapp_validado', type: 'INTEGER DEFAULT 0' }
    ];

    return new Promise((resolve) => {
        database.all(`PRAGMA table_info(leads)`, (err, rows) => {
            if (err) {
                console.error("Erro ao ler info da tabela:", err);
                return resolve();
            }

            const existingColumns = rows.map(row => row.name);
            const promises = [];

            requiredColumns.forEach(col => {
                if (!existingColumns.includes(col.name)) {
                    console.log(`✨ [MIGRAÇÃO] Adicionando coluna faltante: ${col.name}`);
                    promises.push(new Promise((res) => {
                        database.run(`ALTER TABLE leads ADD COLUMN ${col.name} ${col.type}`, () => res());
                    }));
                }
            });

            Promise.all(promises).then(() => {
                console.log("✅ [MIGRAÇÃO] Todas as colunas verificadas/adicionadas.");
                resolve();
            });
        });
    });
}

// Inicializa o Banco
function initDb() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, async (err) => {
            if (err) {
                console.error("Erro ao abrir banco:", err.message);
                reject(err);
            } else {
                console.log('📦 Conectado ao banco SQLite.');
                
                // 1. Cria a tabela base se não existir
                db.run(`CREATE TABLE IF NOT EXISTS leads (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    link_maps TEXT UNIQUE,
                    status TEXT DEFAULT 'new',
                    enriched BOOLEAN DEFAULT 0,
                    data_captura DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, async (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        // 2. Roda a migração para garantir todas as colunas (incluindo 'nome')
                        await migrate(db);
                        resolve();
                    }
                });
            }
        });
    });
}

// Salva um novo lead
function salvarLead(lead, origem = "Scraper", nicho = "") {
    return new Promise((resolve, reject) => {
        if (!db) return reject("DB não inicializado");
        
        const sql = `INSERT OR IGNORE INTO leads (nome, telefone, categoria, link_maps, cidade, bairro, status, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [
            lead.nome, 
            lead.telefone, 
            lead.categoria || nicho, 
            lead.link || lead.link_maps, 
            lead.cidade, 
            lead.bairro || lead.bairro_detectado,
            'new',
            lead.lat || null,
            lead.lng || null
        ];

        db.run(sql, params, function(err) {
            if (err) {
                console.error("Erro SQL ao salvar:", err);
                reject(err);
            } else {
                resolve(this.lastID); 
            }
        });
    });
}

// Pega leads que precisam ser enriquecidos
function getLeadsRecentes(limite = 20) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM leads WHERE enriched = 0 ORDER BY id DESC LIMIT ?`;
        db.all(sql, [limite], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Atualiza o lead com os dados vindos do 3_enrich.js
function atualizarLead(lead) {
    return new Promise((resolve, reject) => {
        const sql = `UPDATE leads SET 
            cnpj = ?, 
            capital_social = ?,
            cnae = ?,
            socios = ?, 
            dono = ?, 
            celular_socio = ?, 
            nome_receita = ?, 
            match_score = ?,
            instagram = ?,
            facebook = ?,
            enriched = 1,
            data_atualizacao = CURRENT_TIMESTAMP
            WHERE link_maps = ?`;
            
        const sociosStr = Array.isArray(lead.socios) ? lead.socios.join(', ') : (lead.socios || "");
        
        const params = [
            lead.cnpj,
            lead.capital_social,
            lead.cnae,
            sociosStr,
            lead.dono || "",
            lead.celular_socio,
            lead.nome_receita,
            lead.match_score,
            lead.instagram,
            lead.facebook,
            lead.link || lead.link_maps
        ];

        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

module.exports = { initDb, salvarLead, getLeadsRecentes, atualizarLead };