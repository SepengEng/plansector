const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

const db = require('../db/connection');
const { extractText } = require('../services/pdfService');
const { extractData } = require('../services/aiService');

const router = express.Router();

/* =========================
   📁 CONFIGURAÇÃO RENDER
========================= */

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
const uploadDir = path.join(dataDir, 'uploads');
const tempZipDir = path.join(uploadDir, 'tmp_zip');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(tempZipDir, { recursive: true });

/* =========================
   📦 MULTER
========================= */

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const nomeFinal =
      Date.now() + '_' + Math.floor(Math.random() * 100000) + path.extname(file.originalname);
    cb(null, nomeFinal);
  }
});

const upload = multer({
  storage,
  limits: { files: 500, fileSize: 50 * 1024 * 1024 }
});

/* =========================
   🔧 HELPERS
========================= */

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function buscarObraPorCodigo(codigo) {
  if (!codigo) return null;
  return await getAsync(
    `SELECT * FROM obras WHERE codigo = ? OR nome = ? LIMIT 1`,
    [codigo, codigo]
  );
}

/* =========================
   📦 LOTE
========================= */

async function criarLote({ nome, tipo, obra, engenheiro, responsavel_recebimento }) {
  const result = await runAsync(
    `INSERT INTO lotes_upload (nome, tipo, obra, engenheiro, responsavel_recebimento, data_upload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      nome || '',
      tipo || 'arquivo',
      obra || '',
      engenheiro || '',
      responsavel_recebimento || '',
      new Date().toISOString().slice(0, 10)
    ]
  );
  return result.lastID;
}

async function atualizarLote(id, { nome, obra, engenheiro, responsavel_recebimento }) {
  await runAsync(
    `UPDATE lotes_upload
     SET nome = ?, obra = ?, engenheiro = ?, responsavel_recebimento = ?
     WHERE id = ?`,
    [
      nome || '',
      obra || '',
      engenheiro || '',
      responsavel_recebimento || '',
      id
    ]
  );
}

/* =========================
   💾 SALVAR DOC
========================= */

async function salvarDocumentoNoBanco(dados) {
  const result = await runAsync(
    `INSERT INTO documentos (
      lote_id,
      obra,
      engenheiro,
      nome_documento,
      tipo,
      revisao,
      vias,
      data_documento,
      data_entrega,
      responsavel_recebimento,
      arquivo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dados.lote_id,
      dados.obra,
      dados.engenheiro,
      dados.nome_documento,
      dados.tipo,
      dados.revisao,
      dados.vias,
      dados.data_documento,
      dados.data_entrega,
      dados.responsavel_recebimento,
      dados.arquivo
    ]
  );
  return result.lastID;
}

/* =========================
   📛 NOME DO LOTE
========================= */

function nomeLoteAutomatico(tipo, obra, nomeBase) {
  if (tipo === 'zip') return `ZIP - ${obra}`;
  if (tipo === 'pasta') return `Pasta - ${obra}`;
  return nomeBase;
}

/* =========================
   📄 PROCESSAR PDF
========================= */

async function processarPdf(filePath, originalName, camposFixos, loteId, nomeManualUnico = '') {
  let text = '';

  try {
    text = await extractText(filePath);
  } catch (error) {
    console.log('Erro ao ler PDF:', originalName);
  }

  const aiData = await extractData(text, originalName);

  const obraDetectada = camposFixos.obra_manual || aiData.obra || 'NÃO IDENTIFICADO';
  const obraCadastrada = await buscarObraPorCodigo(obraDetectada);

  const obraFinal = obraDetectada;

  const engenheiroFinal =
    camposFixos.engenheiro_manual ||
    obraCadastrada?.engenheiro ||
    'Não identificado';

  const documentoFinal =
    nomeManualUnico ||
    aiData.documento ||
    originalName;

  const tipoFinal = aiData.tipo || 'Projeto';

  const id = await salvarDocumentoNoBanco({
    lote_id: loteId,
    obra: obraFinal,
    engenheiro: engenheiroFinal,
    nome_documento: documentoFinal,
    tipo: tipoFinal,
    revisao: aiData.revisao || 'R00',
    vias: aiData.vias || 1,
    data_documento: aiData.data || '',
    data_entrega: new Date().toISOString().slice(0, 10),
    responsavel_recebimento: camposFixos.responsavel_recebimento || '',
    arquivo: filePath
  });

  return {
    id,
    documento: documentoFinal,
    obra: obraFinal,
    engenheiro: engenheiroFinal,
    tipo: tipoFinal,
    revisao: aiData.revisao || 'R00'
  };
}

/* =========================
   🚀 UPLOAD
========================= */

router.post('/upload', upload.array('files', 500), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    const camposFixos = {
      responsavel_recebimento: req.body.responsavel_recebimento || '',
      obra_manual: req.body.obra_manual || '',
      engenheiro_manual: req.body.engenheiro_manual || ''
    };

    const resultados = [];
    let ignorados = 0;

    const temZip = req.files.some(f => f.originalname.endsWith('.zip'));
    const todosPdf = req.files.every(f => f.originalname.endsWith('.pdf'));

    let tipoLote = 'arquivo';
    if (temZip) tipoLote = 'zip';
    else if (req.files.length > 1 && todosPdf) tipoLote = 'pasta';

    const loteId = await criarLote({
      nome: req.files[0].originalname,
      tipo: tipoLote,
      obra: '',
      engenheiro: '',
      responsavel_recebimento: camposFixos.responsavel_recebimento
    });

    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();

      if (ext === '.pdf') {
        const r = await processarPdf(file.path, file.originalname, camposFixos, loteId);
        resultados.push(r);
      }

      else if (ext === '.zip') {
        const zip = new AdmZip(file.path);
        const entries = zip.getEntries();

        for (const entry of entries) {
          if (!entry.entryName.endsWith('.pdf')) continue;

          const tempPath = path.join(tempZipDir, Date.now() + '_' + entry.entryName);
          fs.writeFileSync(tempPath, entry.getData());

          const r = await processarPdf(tempPath, entry.entryName, camposFixos, loteId);
          resultados.push(r);
        }
      }

      else {
        ignorados++;
      }
    }

    const primeiro = resultados[0];

    const nomeFinal = nomeLoteAutomatico(
      tipoLote,
      primeiro.obra,
      primeiro.documento
    );

    await atualizarLote(loteId, {
      nome: nomeFinal,
      obra: primeiro.obra,
      engenheiro: primeiro.engenheiro,
      responsavel_recebimento: camposFixos.responsavel_recebimento
    });

    res.json({
      message: 'Upload concluído',
      total: resultados.length,
      ignorados,
      loteId,
      nomeLote: nomeFinal
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro no upload.' });
  }
});

/* =========================
   📊 LISTAR LOTES
========================= */

router.get('/lotes', async (req, res) => {
  const rows = await allAsync(`
    SELECT l.*, COUNT(d.id) as total_documentos
    FROM lotes_upload l
    LEFT JOIN documentos d ON d.lote_id = l.id
    GROUP BY l.id
    ORDER BY l.id DESC
  `);
  res.json(rows);
});

/* =========================
   📂 DOCUMENTOS DO LOTE
========================= */

router.get('/lotes/:id/documentos', async (req, res) => {
  const rows = await allAsync(
    `SELECT * FROM documentos WHERE lote_id = ?`,
    [req.params.id]
  );
  res.json(rows);
});

/* =========================
   📥 DOWNLOAD
========================= */

router.get('/download/:id', async (req, res) => {
  const doc = await getAsync(`SELECT * FROM documentos WHERE id = ?`, [req.params.id]);

  if (!doc) return res.status(404).send('Não encontrado');

  res.download(doc.arquivo);
});

/* =========================
   📊 RESUMO
========================= */

router.get('/stats/resumo', (req, res) => {
  db.get(`
    SELECT
      COUNT(*) AS total_documentos,
      COUNT(DISTINCT obra) AS total_obras,
      COUNT(DISTINCT engenheiro) AS total_engenheiros,
      COUNT(DISTINCT responsavel_recebimento) AS total_recebedores
    FROM documentos
  `, [], (err, row) => {
    res.json(row);
  });
});

module.exports = router;