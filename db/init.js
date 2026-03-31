const db = require('./connection');

async function initDb() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS obras (
        id SERIAL PRIMARY KEY,
        nome TEXT,
        codigo TEXT UNIQUE,
        engenheiro TEXT
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS lotes_upload (
        id SERIAL PRIMARY KEY,
        nome TEXT,
        tipo TEXT,
        obra TEXT,
        engenheiro TEXT,
        responsavel_recebimento TEXT,
        data_upload TEXT
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS documentos (
        id SERIAL PRIMARY KEY,
        lote_id INTEGER REFERENCES lotes_upload(id),
        obra TEXT,
        engenheiro TEXT,
        nome_documento TEXT,
        tipo TEXT,
        revisao TEXT,
        vias INTEGER,
        data_documento TEXT,
        data_entrega TEXT,
        responsavel_recebimento TEXT,
        arquivo TEXT
      );
    `);

    console.log('✅ Banco inicializado');
  } catch (err) {
    console.error('❌ Erro no initDb:', err);
    throw err;
  }
}

module.exports = initDb;
