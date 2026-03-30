const express = require('express');
const cors = require('cors');
require('./db/init');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use(express.static('public'));

app.use('/documents', require('./routes/documents'));
app.use('/obras', require('./routes/obras'));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});