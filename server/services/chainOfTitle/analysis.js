import { getPool, getOpenAPIKey } from '../../config.js';
import OpenAI from 'openai';
import { formatDate, truncateText } from '../../lib/format.js';

/**
 * Detect gaps in the chain of title.
 * A gap is defined as a period longer than 2 years between consecutive documents.
 */
export function detectChainGaps(chainDocs) {
  if (!chainDocs || chainDocs.length < 2) return [];

  const gaps = [];
  const gapThresholdMs = 2 * 365.25 * 24 * 60 * 60 * 1000; // 2 years in milliseconds

  for (let i = 0; i < chainDocs.length - 1; i++) {
    const currentDoc = chainDocs[i];
    const nextDoc = chainDocs[i + 1];

    if (currentDoc.filingDate && nextDoc.filingDate) {
      const currentDate = new Date(currentDoc.filingDate);
      const nextDate = new Date(nextDoc.filingDate);
      const gap = nextDate - currentDate;

      if (gap > gapThresholdMs) {
        const gapYears = Math.round(gap / (365.25 * 24 * 60 * 60 * 1000) * 10) / 10;
        gaps.push({
          startDate: formatDate(currentDoc.filingDate),
          endDate: formatDate(nextDoc.filingDate),
          years: gapYears,
          fromGrantee: (currentDoc.grantees || 'Unknown').split('; ')[0],
          toGrantor: (nextDoc.grantors || 'Unknown').split('; ')[0]
        });
      }
    }
  }

  return gaps;
}

function buildHeuristicChainNarrative(chainDocs) {
  if (!chainDocs || chainDocs.length === 0) return '';

  const narrative = chainDocs.map((doc, idx) => {
    const grantors = doc.grantors ? doc.grantors.split('; ') : [];
    const grantees = doc.grantees ? doc.grantees.split('; ') : [];
    const fromText = grantors.length > 0 ? grantors.join(' and ') : 'Unknown';
    const toText = grantees.length > 0 ? grantees.join(' and ') : 'Unknown';
    const date = formatDate(doc.filingDate) || 'Unknown date';
    const type = doc.instrumentType || 'Document';

    return `${idx + 1}. On ${date}, ${fromText} transferred the property to ${toText} via ${type}` +
      (doc.book ? ` (Book ${doc.book}/${doc.volume}/${doc.page})` : '') + '.';
  }).join(' ');

  return narrative;
}

export async function generateChainAnalysis(chainDocs, propertyInfo) {
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

    const docSummaries = chainDocs.map((doc, idx) => {
      const grantors = doc.grantors || 'Unknown';
      const grantees = doc.grantees || 'Unknown';
      const date = formatDate(doc.filingDate) || 'Unknown date';
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
            { type: 'input_text', text: prompt }
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

const CHAIN_DOCS_QUERY = `
  SELECT d.*, c.name AS countyName,
         GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees,
         GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors
  FROM Document d
  LEFT JOIN County c ON c.countyID = d.countyID
  LEFT JOIN Party p ON p.documentID = d.documentID
  WHERE d.legalDescription LIKE ? AND d.countyID = ?
  GROUP BY d.documentID
  ORDER BY d.filingDate ASC, d.fileStampDate ASC
`;

const CHAIN_DOCS_BY_ADDRESS_QUERY = `
  SELECT d.*, c.name AS countyName,
         GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees,
         GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors
  FROM Document d
  LEFT JOIN County c ON c.countyID = d.countyID
  LEFT JOIN Party p ON p.documentID = d.documentID
  WHERE d.address LIKE ? AND d.countyID = ?
  GROUP BY d.documentID
  ORDER BY d.filingDate ASC, d.fileStampDate ASC
`;

/**
 * Fetch chain docs by legal description (first 50 chars) or address.
 * Used by GET /chain-of-title.
 */
export async function fetchChainDocsByLegalOrAddress(pool, propertyInfo) {
  const legalDesc = propertyInfo.legalDescription || '';
  const address = propertyInfo.address || '';

  if (legalDesc.trim()) {
    const [results] = await pool.query(CHAIN_DOCS_QUERY, [`%${legalDesc.substring(0, 50)}%`, propertyInfo.countyID]);
    if (results && results.length > 0) return results;
  }

  if (address.trim()) {
    const [results] = await pool.query(CHAIN_DOCS_BY_ADDRESS_QUERY, [`%${address}%`, propertyInfo.countyID]);
    return results || [];
  }

  return [];
}

/**
 * Fetch chain docs for PDF (uses first word of legal or address fallback).
 */
export async function fetchChainDocs(pool, propertyInfo) {
  const legalDesc = propertyInfo.legalDescription || '';
  const address = propertyInfo.address || '';

  if (legalDesc.trim()) {
    const [results] = await pool.query(CHAIN_DOCS_QUERY, [`%${legalDesc.split(' ')[0]}%`, propertyInfo.countyID]);
    if (results && results.length > 0) return results;
  }

  if (address.trim()) {
    const [results] = await pool.query(CHAIN_DOCS_BY_ADDRESS_QUERY, [`%${address}%`, propertyInfo.countyID]);
    return results || [];
  }

  return [];
}
