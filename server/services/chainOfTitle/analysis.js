import { getPool, getOpenAPIKey } from '../../config.js';
import OpenAI from 'openai';
import { formatDate, truncateText } from '../../lib/format.js';

/**
 * Filter chain documents to only include actual ownership transfers (deeds, etc.).
 * Excludes mortgages, liens, and documents without proper grantor/grantee info.
 */
function filterOwnershipChanges(chainDocs) {
  if (!chainDocs || chainDocs.length === 0) return [];

  // Document types that represent ownership transfers
  const ownershipTransferTypes = [
    'deed',
    'warranty deed',
    'special warranty deed',
    'quit claim deed',
    'grant deed',
    'executor deed',
    'trustee deed',
    'administrator deed',
    'marshal deed',
    'sheriff deed',
    'tax deed',
    'conveyance',
    'transfer',
    'assignment',
    'will',
    'court order',
    'judgment'
  ];

  const isOwnershipTransfer = (doc) => {
    if (!doc.instrumentType) return false;
    const type = doc.instrumentType.toLowerCase().trim();
    return ownershipTransferTypes.some(t => type.includes(t));
  };

  // Filter to docs with valid grantees/grantors and ownership transfer types
  const validDocs = chainDocs.filter(doc => {
    const grantees = ensureString(doc.grantees).trim();
    const grantors = ensureString(doc.grantors).trim();
    return grantees && grantors && isOwnershipTransfer(doc);
  });

  if (validDocs.length === 0) return [];

  const ownershipChanges = [validDocs[0]]; // Always include first document

  // Now filter to only actual ownership changes (different grantees between docs)
  for (let i = 1; i < validDocs.length; i++) {
    const prevDoc = validDocs[i - 1];
    const currDoc = validDocs[i];

    const prevGrantees = ensureString(prevDoc.grantees).toLowerCase().trim();
    const currGrantors = ensureString(currDoc.grantors).toLowerCase().trim();

    if (prevGrantees !== currGrantors) {
      ownershipChanges.push(currDoc);
    }
  }

  return ownershipChanges;
}

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

// Helper to ensure value is a string (handles arrays, nulls, etc)
function ensureString(val) {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.join('; ');
  return '';
}

function buildHeuristicChainNarrative(chainDocs) {
  if (!chainDocs || chainDocs.length === 0) return '';

  // Filter to only ownership changes to reduce narrative size
  const ownershipChanges = filterOwnershipChanges(chainDocs);

  const narrative = ownershipChanges.map((doc, idx) => {
    const grantorStr = ensureString(doc.grantors);
    const granteeStr = ensureString(doc.grantees);
    const grantors = grantorStr ? grantorStr.split('; ') : [];
    const grantees = granteeStr ? granteeStr.split('; ') : [];
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
    // Filter to only ownership changes before analysis to keep size manageable
    const ownershipDocs = filterOwnershipChanges(chainDocs);
    
    // If we have too many ownership changes, limit to most recent 50
    const docsForAnalysis = ownershipDocs.length > 50 
      ? ownershipDocs.slice(-50) 
      : ownershipDocs;

    const apiKey = await getOpenAPIKey();
    if (!apiKey) {
      return {
        narrative: buildHeuristicChainNarrative(chainDocs),
        analysis: 'Chain of title generated from document records.',
        source: 'heuristic'
      };
    }

    const openai = new OpenAI({ apiKey });

    const docSummaries = docsForAnalysis.map((doc, idx) => {
      const grantors = ensureString(doc.grantors) || 'Unknown';
      const grantees = ensureString(doc.grantees) || 'Unknown';
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

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a legal title abstractor. Analyze property ownership chains and provide structured analysis. Be concise and factual.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const parsed = JSON.parse(response.choices[0].message.content);
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
