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

function nomeLoteAutomatico(tipoLote, codigoObra, nomeBase) {
  if (tipoLote === 'zip') {
    return codigoObra ? `ZIP - ${codigoObra}` : `ZIP - ${nomeBase}`;
  }
  if (tipoLote === 'pasta') {
    return codigoObra ? `Pasta - ${codigoObra}` : 'Pasta de documentos';
  }
  return nomeBase || 'Arquivo';
}

async function processarPdf(filePath, originalName, camposFixos, loteId, nomeManualUnico = '') {
  let text = '';

  try {
    text = await extractText(filePath);
  } catch (error) {
    console.log('Erro ao ler PDF, continuando:', originalName);
  }

  const aiData = await extractData(text, originalName);
  const obraDetectada = camposFixos.obra_manual || aiData.obra || 'NÃO IDENTIFICADO';

  const obraCadastrada = await buscarObraPorCodigo(obraDetectada);

  const obraFinal =
    camposFixos.obra_manual ||
    obraDetectada ||
    'NÃO IDENTIFICADO';

  const engenheiroFinal =
    camposFixos.engenheiro_manual ||
    aiData.engenheiro ||
    obraCadastrada?.engenheiro ||
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
    arquivo: originalName,
    documento: documentoFinal,
    tipo: tipoFinal,
    obra: obraFinal,
    engenheiro: engenheiroFinal,
    responsavel_recebimento: recebimentoFinal,
    revisao: aiData.revisao || 'R00'
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
      obra: camposFixos.obra_manual,
      engenheiro: camposFixos.engenheiro_manual,
      responsavel_recebimento: camposFixos.responsavel_recebimento
    });

    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();

      if (ext === '.pdf') {
        const usarNomeManual = req.files.length === 1 ? nomeDocumentoManual : '';
        const resultado = await processarPdf(file.path, file.originalname, camposFixos, loteId, usarNomeManual);
        resultados.push(resultado);
        continue;
      }

      if (ext === '.zip') {
        const zip = new AdmZip(file.path);
        const zipEntries = zip.getEntries();

        for (const entry of zipEntries) {
          if (entry.isDirectory) {
            ignorados++;
            continue;
          }

          const entryExt = path.extname(entry.entryName).toLowerCase();
          if (entryExt !== '.pdf') {
            ignorados++;
            continue;
          }

          const nomeBase = path.basename(entry.entryName);
          const caminhoExtraido = path.join(
            tempZipDir,
            Date.now() + '_' + Math.floor(Math.random() * 100000) + '_' + nomeBase
          );

          fs.writeFileSync(caminhoExtraido, entry.getData());

          const resultado = await processarPdf(caminhoExtraido, nomeBase, camposFixos, loteId, '');
          resultados.push(resultado);
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

    const primeiroResultado = resultados[0];

    const obraLote = camposFixos.obra_manual || primeiroResultado.obra || '';
    const engenheiroLote =
      camposFixos.engenheiro_manual ||
      primeiroResultado.engenheiro ||
      '';
    const recebimentoLote =
      camposFixos.responsavel_recebimento ||
      primeiroResultado.responsavel_recebimento ||
      '';

    const nomeLote = nomeLoteAutomatico(
      tipoLote,
      obraLote,
      tipoLote === 'arquivo' ? (primeiroResultado.documento || nomeBasePrimeiro) : nomeBasePrimeiro
    );

    await atualizarLote(loteId, {
      nome: nomeLote,
      obra: obraLote,
      engenheiro: engenheiroLote,
      responsavel_recebimento: recebimentoLote
    });

    res.json({
      message: 'Upload concluído',
      total: resultados.length,
      ignorados,
      loteId,
      tipoLote,
      nomeLote,
      arquivos: resultados
    });
  } catch (error) {
    console.error('Erro no upload:', error);
    res.status(500).json({ error: 'Erro no upload dos documentos.' });
  }
});

router.get('/lotes', async (req, res) => {
  try {
    const rows = await allAsync(`
      SELECT
        l.id,
        l.nome,
        l.tipo,
        l.obra,
        l.engenheiro,
        l.responsavel_recebimento,
        l.data_upload,
        COUNT(d.id) AS total_documentos
      FROM lotes_upload l
      LEFT JOIN documentos d ON d.lote_id = l.id
      GROUP BY l.id
      ORDER BY l.id DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Erro ao listar lotes:', error);
    res.status(500).json({ error: 'Erro ao listar lotes.' });
  }
});

router.get('/lotes/:id/documentos', async (req, res) => {
  try {
    const rows = await allAsync(
      `SELECT * FROM documentos WHERE lote_id = ? ORDER BY id DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Erro ao listar documentos do lote:', error);
    res.status(500).json({ error: 'Erro ao listar documentos do lote.' });
  }
});

router.get('/stats/resumo', (req, res) => {
  db.get(
    `
    SELECT
      COUNT(*) AS total_documentos,
      COUNT(DISTINCT obra) AS total_obras,
      COUNT(DISTINCT engenheiro) AS total_engenheiros,
      COUNT(DISTINCT responsavel_recebimento) AS total_recebedores
    FROM documentos
    `,
    [],
    (err, row) => {
      if (err) {
        console.error('Erro ao buscar resumo:', err);
        return res.status(500).json({ error: 'Erro ao buscar resumo.' });
      }
      res.json(row);
    }
  );
});

router.get('/download/:id', async (req, res) => {
  try {
    const documento = await getAsync(`SELECT * FROM documentos WHERE id = ?`, [req.params.id]);

    if (!documento) {
      return res.status(404).send('Documento não encontrado.');
    }

    if (!documento.arquivo || !fs.existsSync(documento.arquivo)) {
      return res.status(404).send('Arquivo não encontrado no servidor.');
    }

    const extensao = path.extname(documento.arquivo) || '.pdf';
    const nomeSeguro = (documento.nome_documento || `documento_${documento.id}`)
      .replace(/[\/\\:*?"<>|]/g, '_');

    const nomeDownload = `${nomeSeguro}${extensao}`;
    res.download(documento.arquivo, nomeDownload);
  } catch (error) {
    console.error('Erro ao buscar documento:', error);
    res.status(500).send('Erro ao buscar documento.');
  }
});

module.exports = router;