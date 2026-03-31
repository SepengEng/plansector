const express = require('express');
const cors = require('cors');
const path = require('path');

const initDb = require('./db/init');

const app = express();

console.log('🚀 Iniciando aplicação...');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const dataDir = process.env.DATA_DIR || __dirname;
app.use('/uploads', express.static(path.join(dataDir, 'uploads')));

app.use('/documents', require('./routes/documents'));
app.use('/obras', require('./routes/obras'));

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    console.log('🔄 Inicializando banco...');
    await initDb();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Servidor rodando na porta ${PORT}`);
    });
  } catch (error) {
    console.error('❌ ERRO AO INICIAR SERVIDOR:', error);
    process.exit(1);
  }
}

startServer();
