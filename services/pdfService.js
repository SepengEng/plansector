const fs = require('fs');
const pdfParseModule = require('pdf-parse');

const pdfParse =
  typeof pdfParseModule === 'function'
    ? pdfParseModule
    : pdfParseModule.default;

async function extractText(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text || '';
  } catch (error) {
    console.error('Erro ao ler PDF:', error.message);
    return '';
  }
}

module.exports = { extractText };