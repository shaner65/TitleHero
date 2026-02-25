import { getPool } from '../../config.js';
import { PDFDocument, rgb } from 'pdf-lib';
import { formatDate } from '../../lib/format.js';
import { generateChainAnalysis, fetchChainDocs, detectChainGaps } from './analysis.js';

/**
 * Generate chain of title PDF for a document with full analysis.
 * @param {number} documentID - The document ID
 * Returns PDF buffer or throws if document not found.
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
  let y = height - 50;
  const margin = 50;
  const pageWidth = 512; // 612 - 100 margin

  // Helper to wrap text to fit within page width
  const wrapText = (text, fontSize = 10) => {
    const maxCharsPerLine = Math.floor(pageWidth / (fontSize * 0.6));
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (testLine.length <= maxCharsPerLine) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  };

  const addLine = (text, size = 10, color = rgb(0, 0, 0)) => {
    if (y < 50) {
      page = pdfDoc.addPage([612, 792]);
      y = height - 50;
    }
    const lines = wrapText(text, size);
    for (const line of lines) {
      if (y < 50) {
        page = pdfDoc.addPage([612, 792]);
        y = height - 50;
      }
      page.drawText(line, { x: margin, y, size, color });
      y -= size + 4;
    }
  };

  const addParagraph = (text, size = 10, color = rgb(0, 0, 0)) => {
    if (!text) return;
    const paragraphs = text.split('\n');
    for (const para of paragraphs) {
      if (para.trim()) {
        addLine(para.trim(), size, color);
      }
    }
  };

  const headerColor = rgb(31 / 255, 58 / 255, 95 / 255);

  // Title
  page.drawText('Chain of Title Report', { x: margin, y, size: 16, color: headerColor });
  y -= 25;

  // Property info
  if (propertyInfo.legalDescription) {
    addLine(`Property: ${propertyInfo.legalDescription}`, 10);
  }
  if (propertyInfo.address) {
    addLine(`Address: ${propertyInfo.address}`, 10);
  }
  if (propertyInfo.countyName) {
    addLine(`County: ${propertyInfo.countyName}`, 10);
  }
  addLine(`Document ID: ${documentID}`, 10);
  addLine(`Generated: ${new Date().toLocaleString()}`, 9, rgb(0.4, 0.4, 0.4));
  y -= 20;

  // Analysis sections
  if (analysis) {
    page.drawText('Ownership History', { x: margin, y, size: 13, color: headerColor });
    y -= 15;
    addParagraph(analysis.narrative, 10);
    y -= 20;

    page.drawText('Title Analysis', { x: margin, y, size: 13, color: headerColor });
    y -= 15;
    addParagraph(analysis.analysis, 10);
    y -= 20;

    if (analysis.concerns) {
      page.drawText('[!] CONCERNS - Important Information', { x: margin, y, size: 13, color: rgb(0.8, 0, 0) });
      y -= 15;
      addParagraph(analysis.concerns, 10);
      y -= 20;
    }
  }

  // Gap Report
  const gaps = detectChainGaps(chainDocs);
  if (gaps.length > 0) {
    page.drawText('[!] GAP REPORT - Significant Time Gaps Detected', { x: margin, y, size: 13, color: rgb(0.8, 0, 0) });
    y -= 15;
    for (const gap of gaps) {
      const gapText = `Gap of ${gap.years} years between ${gap.startDate} and ${gap.endDate}. ` +
        `Ownership transferred from ${gap.fromGrantee} to ${gap.toGrantor} with no intermediate recorded documents.`;
      addParagraph(gapText, 10);
      y -= 10;
    }
    y -= 15;
  }

  // Document sequence
  page.drawText('Document Sequence', { x: margin, y, size: 13, color: headerColor });
  y -= 8;
  page.drawText('_'.repeat(90), { x: margin, y, size: 9 });
  y -= 20;

  for (let idx = 0; idx < chainDocs.length; idx++) {
    const doc = chainDocs[idx];
    const filingDate = formatDate(doc.filingDate) || 'Unknown';
    const bookRef = [doc.book, doc.volume, doc.page].filter(v => v).join('/');
    const grantors = doc.grantors || 'Unknown';
    const grantees = doc.grantees || 'Unknown';
    const docType = doc.instrumentType || 'Document';
    const isSearched = doc.documentID === documentID;

    if (y < 120) {
      page = pdfDoc.addPage([612, 792]);
      y = height - 50;
    }

    const docLabel = `Document #${idx + 1}${isSearched ? ' (Searched Document)' : ''}`;
    page.drawText(docLabel, { x: margin, y, size: 10, color: isSearched ? headerColor : rgb(0, 0, 0) });
    y -= 16;

    addLine(`FROM: ${grantors}`, 9);
    addLine(`TO: ${grantees}`, 9);
    y -= 4;
    addLine(`Type: ${docType}`, 9, rgb(0.3, 0.3, 0.3));
    addLine(`Date: ${filingDate}`, 9, rgb(0.3, 0.3, 0.3));
    if (bookRef) {
      addLine(`Recording: Volume/Page ${bookRef}`, 9, rgb(0.3, 0.3, 0.3));
    }
    y -= 20;
  }

  y -= 10;
  page.drawText('_'.repeat(90), { x: margin, y, size: 9 });
  y -= 12;
  page.drawText(`Total Documents in Chain: ${chainDocs.length}`, { x: margin, y, size: 10, color: headerColor });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
