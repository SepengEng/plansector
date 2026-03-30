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

app.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000');
});