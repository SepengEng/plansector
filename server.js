const db = require('./db/connection');

async function init() {
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
      lote_id INTEGER REFERENCES lotes_upload(id) ON DELETE SET NULL,
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

  console.log('PostgreSQL inicializado com sucesso.');
}

module.exports = init;console.log('TESTE RENDER');
// TESTE GITHUB Tue Mar 31 11:47:30 -03 2026
