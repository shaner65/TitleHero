import express from 'express';
import { getPool, getOpenAPIKey } from '../config.js';
import OpenAI from 'openai';
import { PDFDocument, rgb } from 'pdf-lib';

const app = express();
app.use(express.json());

// Helper: format date
function formatDateForDisplay(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

// Helper: truncate text
function truncateText(text, limit = 500) {
  if (!text) return '';
  const str = String(text).trim();
  if (str.length <= limit) return str;
  return `${str.slice(0, limit)}…`;
}

// Helper: Build heuristic chain narrative
function buildHeuristicChainNarrative(chainDocs) {
  if (!chainDocs || chainDocs.length === 0) return '';
  
  const narrative = chainDocs.map((doc, idx) => {
    const grantors = doc.grantors ? doc.grantors.split('; ') : [];
    const grantees = doc.grantees ? doc.grantees.split('; ') : [];
    const fromText = grantors.length > 0 ? grantors.join(' and ') : 'Unknown';
    const toText = grantees.length > 0 ? grantees.join(' and ') : 'Unknown';
    const date = formatDateForDisplay(doc.filingDate) || 'Unknown date';
    const type = doc.instrumentType || 'Document';
    
    return `${idx + 1}. On ${date}, ${fromText} transferred the property to ${toText} via ${type}` +
           (doc.book ? ` (Book ${doc.book}/${doc.volume}/${doc.page})` : '') + '.';
  }).join(' ');
  
  return narrative;
}

// AI: Generate chain of title analysis
async function generateChainAnalysis(chainDocs, propertyInfo) {
  try {
    const apiKey = await getOpenAPIKey();
    if (!apiKey) {
      return {
        narrative: buildHeuristicChainNarrative(chainDocs),
        analysis: 'Chain of title generated from document records.',
        source: 'heuristic'
      };
    }

    const openai = new OpenAI({ apiKey });

    // Build context for AI
    const docSummaries = chainDocs.map((doc, idx) => {
      const grantors = doc.grantors || 'Unknown';
      const grantees = doc.grantees || 'Unknown';
      const date = formatDateForDisplay(doc.filingDate) || 'Unknown date';
      const type = doc.instrumentType || 'Document';
      const bookRef = [doc.book, doc.volume, doc.page].filter(Boolean).join('/');
      const legal = truncateText(doc.legalDescription, 300);
      
      return `Step ${idx + 1}:\n` +
             `  Date: ${date}\n` +
             `  From (Grantor): ${grantors}\n` +
             `  To (Grantee): ${grantees}\n` +
             `  Type: ${type}\n` +
             `  Reference: Book/Vol/Page ${bookRef}\n` +
             `  Legal Description: ${legal}`;
    }).join('\n\n');

    const prompt = `You are a legal title abstractor. Analyze this chain of title and provide:
1. A clear narrative of ownership transfers
2. Any gaps or concerns in the chain
3. A brief assessment of chain continuity

Chain of Title:
${docSummaries}

Property Info:
Legal Description: ${truncateText(propertyInfo?.legalDescription, 500)}
Address: ${propertyInfo?.address}

Respond in JSON format with exactly these keys: narrative, analysis, concerns`;

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      text: {
        format: {
          type: 'json_schema',
          name: 'chain_of_title_analysis',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              narrative: { type: 'string' },
              analysis: { type: 'string' },
              concerns: { type: 'string' }
            },
            required: ['narrative', 'analysis', 'concerns'],
            additionalProperties: false
          }
        }
      },
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'You are a legal title abstractor. Analyze property ownership chains and provide structured analysis. Be concise and factual.'
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: prompt
            }
          ]
        }
      ]
    });

    const parsed = JSON.parse(response.output_text);
    return {
      narrative: parsed.narrative,
      analysis: parsed.analysis,
      concerns: parsed.concerns,
      source: 'ai'
    };
  } catch (err) {
    console.error('AI chain analysis failed:', err);
    return {
      narrative: buildHeuristicChainNarrative(chainDocs),
      analysis: 'Chain of title generated from document records.',
      concerns: 'Unable to perform detailed AI analysis at this time.',
      source: 'heuristic'
    };
  }
}

// GET /chain-of-title/:documentID - Get chain of title for a property
app.get('/chain-of-title/:documentID', async (req, res) => {
  try {
    const documentID = parseInt(req.params.documentID, 10);
    if (isNaN(documentID) || documentID <= 0) {
      return res.status(400).json({ error: 'Invalid documentID' });
    }

    const pool = await getPool();

    // Get the starting document
    const [startDoc] = await pool.query(
      `SELECT d.*, c.name AS countyName,
              GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees,
              GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors
       FROM Document d
       LEFT JOIN County c ON c.countyID = d.countyID
       LEFT JOIN Party p ON p.documentID = d.documentID
       WHERE d.documentID = ?
       GROUP BY d.documentID`,
      [documentID]
    );

    if (!startDoc || startDoc.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const propertyInfo = startDoc[0];

    // Get all documents related to this property by legal description or address
    const legalDesc = propertyInfo.legalDescription;
    const address = propertyInfo.address;

    let chainDocs = [];

    if (legalDesc) {
      // Find all docs with similar legal description
      const [relatedDocs] = await pool.query(
        `SELECT d.*, c.name AS countyName,
                GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees,
                GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors
         FROM Document d
         LEFT JOIN County c ON c.countyID = d.countyID
         LEFT JOIN Party p ON p.documentID = d.documentID
         WHERE d.legalDescription LIKE ?
         AND d.countyID = ?
         GROUP BY d.documentID
         ORDER BY d.filingDate ASC, d.fileStampDate ASC`,
        [`%${legalDesc.substring(0, 50)}%`, propertyInfo.countyID]
      );
      chainDocs = relatedDocs;
    } else if (address) {
      // Fallback: find docs with similar address
      const [relatedDocs] = await pool.query(
        `SELECT d.*, c.name AS countyName,
                GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees,
                GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors
         FROM Document d
         LEFT JOIN County c ON c.countyID = d.countyID
         LEFT JOIN Party p ON p.documentID = d.documentID
         WHERE d.address LIKE ?
         AND d.countyID = ?
         GROUP BY d.documentID
         ORDER BY d.filingDate ASC, d.fileStampDate ASC`,
        [`%${address}%`, propertyInfo.countyID]
      );
      chainDocs = relatedDocs;
    }

    // Generate AI analysis
    const analysis = await generateChainAnalysis(chainDocs, propertyInfo);

    res.status(200).json({
      propertyInfo,
      chainDocs,
      analysis,
      documentCount: chainDocs.length
    });
  } catch (err) {
    console.error('Error fetching chain of title:', err);
    res.status(500).json({ error: 'Failed to fetch chain of title' });
  }
});

// Export chain of title as PDF
app.get('/chain-of-title-pdf/:documentID', async (req, res) => {
  try {
    const documentID = parseInt(req.params.documentID);
    const pool = await getPool();

    // Fetch the original document
    const [docs] = await pool.query(
      `SELECT d.*, c.name AS countyName
       FROM Document d
       LEFT JOIN County c ON c.countyID = d.countyID
       WHERE d.documentID = ?`,
      [documentID]
    );

    if (!docs || docs.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const propertyInfo = docs[0];

    // Fetch chain of title
    let chainDocs = [];
    const legalDesc = propertyInfo.legalDescription || '';
    const address = propertyInfo.address || '';

    if (legalDesc.trim()) {
      const [results] = await pool.query(
        `SELECT d.*, c.name AS countyName,
                GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees,
                GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors
         FROM Document d
         LEFT JOIN County c ON c.countyID = d.countyID
         LEFT JOIN Party p ON p.documentID = d.documentID
         WHERE d.legalDescription LIKE ?
         AND d.countyID = ?
         GROUP BY d.documentID
         ORDER BY d.filingDate ASC, d.fileStampDate ASC`,
        [`%${legalDesc.split(' ')[0]}%`, propertyInfo.countyID]
      );
      chainDocs = results;
    }

    if (chainDocs.length === 0 && address.trim()) {
      const [results] = await pool.query(
        `SELECT d.*, c.name AS countyName,
                GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees,
                GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors
         FROM Document d
         LEFT JOIN County c ON c.countyID = d.countyID
         LEFT JOIN Party p ON p.documentID = d.documentID
         WHERE d.address LIKE ?
         AND d.countyID = ?
         GROUP BY d.documentID
         ORDER BY d.filingDate ASC, d.fileStampDate ASC`,
        [`%${address}%`, propertyInfo.countyID]
      );
      chainDocs = results;
    }

    // Generate AI analysis
    const analysis = await generateChainAnalysis(chainDocs, propertyInfo);

    // Create PDF
    const pdfDoc = await PDFDocument.create();
    
    let page = pdfDoc.addPage([612, 792]); // Letter size
    const { height } = page.getSize();
    let y = height - 40;
    const margin = 40;
    const pageWidth = 612 - (margin * 2);

    // Helper to add text with wrapping
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
          const estimatedWidth = testLine.length * (size * 0.5); // Rough estimate
          
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

    // Title
    addText('Chain of Title Report', 16, true, rgb(31/255, 58/255, 95/255));
    y -= 8;

    // Document info
    addText(`Primary Document ID: ${documentID}`, 11);
    addText(`Generated: ${new Date().toLocaleString()}`, 11);
    y -= 12;

    // Ownership History
    addText('Ownership History', 13, true, rgb(31/255, 58/255, 95/255));
    y -= 4;
    addText(analysis.narrative, 11);
    y -= 12;

    // Title Analysis
    addText('Title Analysis', 13, true, rgb(31/255, 58/255, 95/255));
    y -= 4;
    addText(analysis.analysis, 11);
    y -= 12;

    // Concerns
    if (analysis.concerns) {
      addText('CONCERNS - Important Information', 13, true, rgb(31/255, 58/255, 95/255));
      y -= 4;
      addText(analysis.concerns, 11);
      y -= 12;
    }

    // Document Sequence
    addText('Document Sequence', 13, true, rgb(31/255, 58/255, 95/255));
    y -= 8;

    for (let idx = 0; idx < chainDocs.length; idx++) {
      const doc = chainDocs[idx];
      const filingDate = formatDateForDisplay(doc.filingDate) || 'Unknown';
      const bookRef = [doc.book, doc.volume, doc.page].filter(v => v).join('/');
      const grantors = doc.grantors || 'Unknown';
      const grantees = doc.grantees || 'Unknown';
      const type = doc.instrumentType || 'Document';
      const isSearched = doc.documentID === documentID;

      y -= 4;
      addText(`${idx + 1}${isSearched ? ' (Searched Document)' : ''}`, 11, true, isSearched ? rgb(31/255, 58/255, 95/255) : rgb(0, 0, 0));
      addText(`Date: ${filingDate}`, 10);
      addText(`Type: ${type}`, 10);
      if (bookRef) addText(`Reference: ${bookRef}`, 10);
      addText(`From: ${grantors}`, 10);
      addText(`To: ${grantees}`, 10);
      y -= 8;
    }

    // Footer
    y -= 12;
    addText(`Total Documents: ${chainDocs.length}`, 10);

    // Save and send
    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="chain-of-title-${documentID}.pdf"`);
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error('Error generating chain of title PDF:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ error: 'Failed to generate PDF', details: err.message });
  }
});

export default app;
