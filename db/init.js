const db = require('./connection');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS obras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      codigo TEXT,
      engenheiro TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lotes_upload (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      tipo TEXT, -- arquivo | pasta | zip
      obra TEXT,
      engenheiro TEXT,
      responsavel_recebimento TEXT,
      data_upload TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS documentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lote_id INTEGER,
      obra TEXT,
      engenheiro TEXT,
      nome_documento TEXT,
      tipo TEXT,
      revisao TEXT,
      vias INTEGER,
      data_documento TEXT,
      data_entrega TEXT,
      responsavel_recebimento TEXT,
      arquivo TEXT,
      FOREIGN KEY (lote_id) REFERENCES lotes_upload(id)
    )
  `);

  db.all(`PRAGMA table_info(documentos)`, [], (err, rows) => {
    if (!err) {
      const hasLoteId = rows.some(col => col.name === 'lote_id');
      if (!hasLoteId) {
        db.run(`ALTER TABLE documentos ADD COLUMN lote_id INTEGER`);
      }
    }
  });
});

console.log('Banco inicializado.');