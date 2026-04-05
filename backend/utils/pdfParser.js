import https from 'https';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParseModule = require('pdf-parse');
console.log('pdfParseModule:', pdfParseModule);
console.log('type:', typeof pdfParseModule);
console.log('keys:', Object.keys(pdfParseModule));
// pdf-parse v2 exports differently — handle both cases
const pdfParse = pdfParseModule.default || pdfParseModule;

const downloadToBuffer = (url) => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
};

export const extractTextFromPDF = async (filePathOrUrl) => {
  try {
    let buffer;

    if (filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://')) {
      buffer = await downloadToBuffer(filePathOrUrl);
    } else {
      const fs = await import('fs/promises');
      buffer = await fs.readFile(filePathOrUrl);
    }

    const data = await pdfParse(buffer);

    return {
      text: data.text,
      numPages: data.numpages,
      info: data.info,
    };
  } catch (error) {
    console.error("PDF parsing error:", error);
    throw new Error("Failed to extract text from PDF");
  }
};