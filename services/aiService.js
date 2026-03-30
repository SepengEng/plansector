function limparNomeArquivo(nomeArquivo) {
  return nomeArquivo
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairCodigoObraDoArquivo(nomeArquivo) {
  const nomeLimpo = limparNomeArquivo(nomeArquivo);

  const padroes = [
    /\b([A-Za-z]{2,5}-?\d{1,5})\b/,
    /\b(\d{2,5})\b/
  ];

  for (const regex of padroes) {
    const match = nomeLimpo.match(regex);
    if (match) {
      return match[1].replace(/\s+/g, '-').toUpperCase();
    }
  }

  return '';
}

function extrairRevisao(texto = '') {
  const match = texto.match(/\bR\s?(\d{1,2})\b/i);
  if (!match) return 'R00';
  return `R${String(match[1]).padStart(2, '0')}`;
}

function extrairNomeDocumentoDoArquivo(nomeArquivo, codigoObra) {
  const nomeLimpo = limparNomeArquivo(nomeArquivo);

  if (!codigoObra) {
    return nomeLimpo;
  }

  const regexCodigo = new RegExp(codigoObra.replace('-', '[- ]?'), 'i');
  const semCodigo = nomeLimpo.replace(regexCodigo, '').trim();

  return semCodigo || nomeLimpo;
}

function classificarTipoDocumento(nomeDocumento = '', texto = '') {
  const base = `${nomeDocumento} ${texto}`.toLowerCase();

  const regras = [
    {
      tipo: 'Estrutural',
      palavras: ['estrutural', 'estrutura', 'forma', 'armacao', 'armação', 'viga', 'pilar', 'laje']
    },
    {
      tipo: 'Arquitetônico',
      palavras: ['arquitetura', 'arquitetonico', 'arquitetônico', 'planta baixa', 'corte', 'fachada', 'layout']
    },
    {
      tipo: 'Elétrico',
      palavras: ['eletrico', 'elétrico', 'energia', 'iluminacao', 'iluminação', 'tomadas', 'quadro elétrico', 'quadro eletrico']
    },
    {
      tipo: 'Hidráulico',
      palavras: ['hidraulico', 'hidráulico', 'hidrossanitario', 'hidrossanitário', 'agua', 'água', 'esgoto', 'sanitario', 'sanitário']
    },
    {
      tipo: 'Fundação',
      palavras: ['fundacao', 'fundação', 'estaca', 'sapata', 'bloco de coroamento', 'sondagem']
    },
    {
      tipo: 'Implantação',
      palavras: ['implantacao', 'implantação', 'locacao', 'locação', 'situacao', 'situação']
    },
    {
      tipo: 'Combate a Incêndio',
      palavras: ['incendio', 'incêndio', 'sprinkler', 'hidrante', 'alarme de incendio', 'alarme de incêndio']
    },
    {
      tipo: 'Memorial',
      palavras: ['memorial', 'memorial descritivo', 'descritivo', 'especificacao', 'especificação']
    },
    {
      tipo: 'Detalhamento',
      palavras: ['detalhamento', 'detalhe construtivo', 'detalhe']
    },
    {
      tipo: 'Orçamento',
      palavras: ['orcamento', 'orçamento', 'custos', 'composicao de precos', 'composição de preços']
    },
    {
      tipo: 'Cronograma',
      palavras: ['cronograma', 'planejamento', 'linha de balanco', 'linha de balanço']
    }
  ];

  for (const regra of regras) {
    if (regra.palavras.some(p => base.includes(p))) {
      return regra.tipo;
    }
  }

  return 'Projeto';
}

function extrairData(text = '') {
  const match = text.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
  return match ? match[0] : '';
}

function extrairVias(text = '') {
  const match = text.match(/\b(\d+)\s+via[s]?\b/i);
  return match ? Number(match[1]) : 1;
}

async function extractData(text, originalFileName = '') {
  const codigoObraArquivo = extrairCodigoObraDoArquivo(originalFileName);
  const nomeDocumentoArquivo = extrairNomeDocumentoDoArquivo(originalFileName, codigoObraArquivo);

  const textoSeguro = text || '';
  const revisao = extrairRevisao(`${originalFileName} ${textoSeguro}`);
  const tipo = classificarTipoDocumento(nomeDocumentoArquivo, textoSeguro);
  const data = extrairData(textoSeguro);
  const vias = extrairVias(textoSeguro);

  return {
    obra: codigoObraArquivo || 'NÃO IDENTIFICADO',
    engenheiro: '',
    documento: nomeDocumentoArquivo || 'Documento sem nome',
    tipo,
    revisao,
    vias,
    data
  };
}

module.exports = { extractData };