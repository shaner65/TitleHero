import { getPool } from '../../config.js';
import { PDFDocument, rgb } from 'pdf-lib';
import { formatDate } from '../../lib/format.js';
import { generateChainAnalysis, fetchChainDocs } from './analysis.js';

/**
 * Generate chain of title PDF for a document.
 * Returns { pdfBuffer } or throws if document not found.
 */
export async function generateChainOfTitlePdf(documentID) {
  const pool = await getPool();

  const [docs] = await pool.query(
    `SELECT d.*, c.name AS countyName
     FROM Document d
     LEFT JOIN County c ON c.countyID = d.countyID
     WHERE d.documentID = ?`,
    [documentID]
  );

  if (!docs || docs.length === 0) {
    const err = new Error('Document not found');
    err.status = 404;
    throw err;
  }

  const propertyInfo = docs[0];
  const chainDocs = await fetchChainDocs(pool, propertyInfo);
  const analysis = await generateChainAnalysis(chainDocs, propertyInfo);

  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([612, 792]);
  const { height } = page.getSize();
  let y = height - 40;
  const margin = 40;
  const pageWidth = 612 - (margin * 2);

  const addText = (text, size = 11, bold = false, color = rgb(0, 0, 0)) => {
    if (y < 40) {
      page = pdfDoc.addPage([612, 792]);
      y = height - 40;
    }

    const lines = text.split('\n');
    for (const line of lines) {
      const words = line.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const estimatedWidth = testLine.length * (size * 0.5);

        if (estimatedWidth > pageWidth && currentLine) {
          page.drawText(currentLine, { x: margin, y, size, color });
          y -= size + 4;
          if (y < 40) {
            page = pdfDoc.addPage([612, 792]);
            y = height - 40;
          }
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        page.drawText(currentLine, { x: margin, y, size, color });
        y -= size + 4;
      }
    }
  };

  const headerColor = rgb(31 / 255, 58 / 255, 95 / 255);

  addText('Chain of Title Report', 16, true, headerColor);
  y -= 8;

  addText(`Primary Document ID: ${documentID}`, 11);
  addText(`Generated: ${new Date().toLocaleString()}`, 11);
  y -= 12;

  addText('Ownership History', 13, true, headerColor);
  y -= 4;
  addText(analysis.narrative, 11);
  y -= 12;

  addText('Title Analysis', 13, true, headerColor);
  y -= 4;
  addText(analysis.analysis, 11);
  y -= 12;

  if (analysis.concerns) {
    addText('CONCERNS - Important Information', 13, true, headerColor);
    y -= 4;
    addText(analysis.concerns, 11);
    y -= 12;
  }

  addText('Document Sequence', 13, true, headerColor);
  y -= 8;

  for (let idx = 0; idx < chainDocs.length; idx++) {
    const doc = chainDocs[idx];
    const filingDate = formatDate(doc.filingDate) || 'Unknown';
    const bookRef = [doc.book, doc.volume, doc.page].filter(v => v).join('/');
    const grantors = doc.grantors || 'Unknown';
    const grantees = doc.grantees || 'Unknown';
    const type = doc.instrumentType || 'Document';
    const isSearched = doc.documentID === documentID;

    y -= 4;
    addText(`${idx + 1}${isSearched ? ' (Searched Document)' : ''}`, 11, true, isSearched ? headerColor : rgb(0, 0, 0));
    addText(`Date: ${filingDate}`, 10);
    addText(`Type: ${type}`, 10);
    if (bookRef) addText(`Reference: ${bookRef}`, 10);
    addText(`From: ${grantors}`, 10);
    addText(`To: ${grantees}`, 10);
    y -= 8;
  }

  y -= 12;
  addText(`Total Documents: ${chainDocs.length}`, 10);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
