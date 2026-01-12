const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

// Inicializa o banco
async function openDb() {
  return open({
    filename: './leads.db',
    driver: sqlite3.Database
  });
}

// Cria a tabela
async function initDb() {
  const db = await openDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa TEXT,
      telefone TEXT UNIQUE,
      bairro TEXT,
      link TEXT,
      status TEXT DEFAULT 'NOVO', 
      nicho TEXT,
      cidade TEXT,
      data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('💾 Banco de Dados Conectado!');
  return db;
}

// Salva lead
async function salvarLead(lead, cidade, nicho) {
  const db = await openDb();
  try {
    await db.run(
      `INSERT OR IGNORE INTO leads (empresa, telefone, bairro, link, nicho, cidade) VALUES (?, ?, ?, ?, ?, ?)`,
      [lead.empresa_maps, lead.telefone_maps, lead.bairro_detectado, lead.link_maps, nicho, cidade]
    );
  } catch (e) {
    console.error('Erro ao salvar:', e);
  }
}

// Lista leads
async function listarLeads() {
  const db = await openDb();
  return db.all('SELECT * FROM leads ORDER BY id DESC');
}

// Atualiza status
async function atualizarStatus(id, novoStatus) {
  const db = await openDb();
  await db.run('UPDATE leads SET status = ? WHERE id = ?', [novoStatus, id]);
}

module.exports = { initDb, salvarLead, listarLeads, atualizarStatus };