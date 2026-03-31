const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

const db = require('../db/connection');
const { extractText } = require('../services/pdfService');
const { extractData } = require('../services/aiService');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
const tempZipDir = path.join(uploadDir, 'tmp_zip');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(tempZipDir, { recursive: true });

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

async function buscarObraPorCodigo(codigo) {
  if (!codigo) return null;

  const result = await db.query(
    `SELECT * FROM obras WHERE codigo = $1 OR nome = $1 LIMIT 1`,
    [codigo]
  );

  return result.rows[0] || null;
}

async function criarLote({ nome, tipo, obra, engenheiro, responsavel_recebimento }) {
  const result = await db.query(
    `
    INSERT INTO lotes_upload (nome, tipo, obra, engenheiro, responsavel_recebimento, data_upload)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
    `,
    [
      nome || '',
      tipo || 'arquivo',
      obra || '',
      engenheiro || '',
      responsavel_recebimento || '',
      new Date().toISOString().slice(0, 10)
    ]
  );

  return result.rows[0].id;
}

async function atualizarLote(id, { nome, obra, engenheiro, responsavel_recebimento }) {
  await db.query(
    `
    UPDATE lotes_upload
    SET nome = $1, obra = $2, engenheiro = $3, responsavel_recebimento = $4
    WHERE id = $5
    `,
    [nome || '', obra || '', engenheiro || '', responsavel_recebimento || '', id]
  );
}

async function salvarDocumentoNoBanco(dados) {
  const result = await db.query(
    `
    INSERT INTO documentos (
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
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id
    `,
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

  return result.rows[0].id;
}

function nomeLoteAutomatico(tipo, obra, nomeBase) {
  if (tipo === 'zip') return obra ? `ZIP - ${obra}` : 'ZIP';
  if (tipo === 'pasta') return obra ? `Pasta - ${obra}` : 'Pasta de documentos';
  return nomeBase || 'Arquivo';
}

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
    aiData.engenheiro ||
    'Não identificado';

  const documentoFinal =
    nomeManualUnico ||
    aiData.documento ||
    originalName;

  const tipoFinal = aiData.tipo || 'Projeto';
  const recebimentoFinal = camposFixos.responsavel_recebimento || '';

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
    responsavel_recebimento: recebimentoFinal,
    arquivo: filePath
  });

  return {
    id,
    documento: documentoFinal,
    obra: obraFinal,
    engenheiro: engenheiroFinal,
    tipo: tipoFinal,
    revisao: aiData.revisao || 'R00',
    responsavel_recebimento: recebimentoFinal
  };
}

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

    const nomeDocumentoManual = req.body.nome_documento_manual || '';
    const resultados = [];
    let ignorados = 0;

    const temZip = req.files.some(f => path.extname(f.originalname).toLowerCase() === '.zip');
    const todosPdf = req.files.every(f => path.extname(f.originalname).toLowerCase() === '.pdf');

    let tipoLote = 'arquivo';
    if (temZip) tipoLote = 'zip';
    else if (req.files.length > 1 && todosPdf) tipoLote = 'pasta';

    const nomeBasePrimeiro = req.files[0]?.originalname || 'Arquivo';

    const loteId = await criarLote({
      nome: nomeBasePrimeiro,
      tipo: tipoLote,
      obra: '',
      engenheiro: '',
      responsavel_recebimento: camposFixos.responsavel_recebimento
    });

    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();

      if (ext === '.pdf') {
        const usarNomeManual = req.files.length === 1 ? nomeDocumentoManual : '';
        const r = await processarPdf(file.path, file.originalname, camposFixos, loteId, usarNomeManual);
        resultados.push(r);
        continue;
      }

      if (ext === '.zip') {
        const zip = new AdmZip(file.path);
        const entries = zip.getEntries();

        for (const entry of entries) {
          if (entry.isDirectory) {
            ignorados++;
            continue;
          }

          if (!entry.entryName.toLowerCase().endsWith('.pdf')) {
            ignorados++;
            continue;
          }

          const nomeInterno = path.basename(entry.entryName);
          const tempPath = path.join(
            tempZipDir,
            Date.now() + '_' + Math.floor(Math.random() * 100000) + '_' + nomeInterno
          );

          fs.writeFileSync(tempPath, entry.getData());

          const r = await processarPdf(tempPath, nomeInterno, camposFixos, loteId);
          resultados.push(r);
        }

        continue;
      }

      ignorados++;
    }

    if (resultados.length === 0) {
      return res.status(400).json({
        error: 'Nenhum PDF válido encontrado. Envie PDFs, ZIP com PDFs ou uma pasta com PDFs.'
      });
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

router.get('/lotes', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        l.*,
        COUNT(d.id) AS total_documentos
      FROM lotes_upload l
      LEFT JOIN documentos d ON d.lote_id = l.id
      GROUP BY l.id
      ORDER BY l.id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar lotes:', error);
    res.status(500).json({ error: 'Erro ao listar lotes.' });
  }
});

router.get('/lotes/:id/documentos', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM documentos WHERE lote_id = $1 ORDER BY id DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao listar documentos do lote:', error);
    res.status(500).json({ error: 'Erro ao listar documentos do lote.' });
  }
});

router.get('/download/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM documentos WHERE id = $1`,
      [req.params.id]
    );

    const doc = result.rows[0];

    if (!doc) {
      return res.status(404).send('Não encontrado');
    }

    if (!doc.arquivo || !fs.existsSync(doc.arquivo)) {
      return res.status(404).send('Arquivo não encontrado');
    }

    res.download(doc.arquivo);
  } catch (error) {
    console.error('Erro ao baixar documento:', error);
    res.status(500).send('Erro ao baixar documento');
  }
});

router.get('/stats/resumo', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) AS total_documentos,
        COUNT(DISTINCT obra) AS total_obras,
        COUNT(DISTINCT engenheiro) AS total_engenheiros,
        COUNT(DISTINCT responsavel_recebimento) AS total_recebedores
      FROM documentos
    `);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao buscar resumo:', error);
    res.status(500).json({ error: 'Erro ao buscar resumo.' });
  }
});

module.exports = router;