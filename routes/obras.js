const express = require('express');
const db = require('../db/connection');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { codigo, engenheiro } = req.body;

    if (!codigo) {
      return res.status(400).json({ error: 'Código da obra é obrigatório.' });
    }

    const result = await db.query(
      `
      INSERT INTO obras (nome, codigo, engenheiro)
      VALUES ($1, $2, $3)
      ON CONFLICT (codigo)
      DO UPDATE SET engenheiro = EXCLUDED.engenheiro
      RETURNING id
      `,
      [codigo, codigo, engenheiro || '']
    );

    res.json({
      message: 'Obra cadastrada com sucesso.',
      id: result.rows[0].id
    });
  } catch (error) {
    console.error('Erro ao cadastrar obra:', error);
    res.status(500).json({ error: 'Erro ao cadastrar obra.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM obras ORDER BY codigo ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar obras:', error);
    res.status(500).json({ error: 'Erro ao listar obras.' });
  }
});

module.exports = router;