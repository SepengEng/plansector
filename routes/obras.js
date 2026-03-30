const express = require('express');
const db = require('../db/connection');

const router = express.Router();

router.post('/', (req, res) => {
  const { codigo, engenheiro } = req.body;

  if (!codigo) {
    return res.status(400).json({ error: 'Código da obra é obrigatório.' });
  }

  db.run(
    `INSERT INTO obras (nome, codigo, engenheiro) VALUES (?, ?, ?)`,
    [codigo, codigo, engenheiro || ''],
    function (err) {
      if (err) {
        console.error('Erro ao cadastrar obra:', err);
        return res.status(500).json({ error: 'Erro ao cadastrar obra.' });
      }

      res.json({
        message: 'Obra cadastrada com sucesso.',
        id: this.lastID
      });
    }
  );
});

router.get('/', (req, res) => {
  db.all(`SELECT * FROM obras ORDER BY codigo ASC`, [], (err, rows) => {
    if (err) {
      console.error('Erro ao listar obras:', err);
      return res.status(500).json({ error: 'Erro ao listar obras.' });
    }

    res.json(rows);
  });
});

module.exports = router;