import { getPool, getOpenAPIKey } from '../../config.js';
import OpenAI from 'openai';
import { formatDate, truncateText } from '../../lib/format.js';

/**
 * Normalize legal descriptions for comparison.
 * Handles common variations in how the same property is recorded:
 * - Different punctuation: "LOT 1, BLOCK 2" vs "LOT 1 BLOCK 2"
 * - Common abbreviations: BLK/BLOCK, ADD/ADDITION, SEC/SECTION
 * - Extra whitespace
 */
function normalizeLegalDescription(desc) {
  if (!desc) return '';
  return String(desc)
    .toLowerCase()
    .replace(/[,;:.'"()#\-\/\\]/g, ' ')  // Replace punctuation with space
    .replace(/\bbk\b/g, 'block')
    .replace(/\bblk\b/g, 'block')
    .replace(/\badd\b/g, 'addition')
    .replace(/\bsec\b/g, 'section')
    .replace(/\btwp\b/g, 'township')
    .replace(/\brng\b/g, 'range')
    .replace(/\bpt\b/g, 'part')
    .replace(/\btr\b/g, 'tract')
    .replace(/\s+/g, ' ')  // Collapse multiple spaces
    .trim();
}

/**
 * Extract key identifying components from a legal description.
 * Returns null if unable to extract meaningful identifiers.
 */
function extractLegalDescriptionKeys(desc) {
  if (!desc) return null;
  const normalized = normalizeLegalDescription(desc);
  
  // Try to extract lot, block, and subdivision/addition name
  const lotMatch = normalized.match(/lot\s*(\d+)/i);
  const blockMatch = normalized.match(/block\s*(\d+)/i);
  
  // Try to find subdivision name - usually after "block X" or at the end
  // Common patterns: "SUNSHINE ADDITION", "RIVER ESTATES", etc.
  let subdivisionMatch = normalized.match(/(?:block\s*\d+\s+)?([a-z]+(?:\s+[a-z]+)*\s+(?:addition|add|subdivision|estates|heights|hills|park|place|acres|ranch|plat|unit|phase|amended))/i);
  if (!subdivisionMatch) {
    // Try simpler pattern - words after block number
    subdivisionMatch = normalized.match(/block\s*\d+\s+(.+)/i);
  }
  
  // For section/township/range (rural property)
  const sectionMatch = normalized.match(/section\s*(\d+)/i);
  const townshipMatch = normalized.match(/township\s*(\d+)/i);
  const rangeMatch = normalized.match(/range\s*(\d+)/i);
  
  const keys = {
    lot: lotMatch ? lotMatch[1] : null,
    block: blockMatch ? blockMatch[1] : null,
    subdivision: subdivisionMatch ? subdivisionMatch[1].trim() : null,
    section: sectionMatch ? sectionMatch[1] : null,
    township: townshipMatch ? townshipMatch[1] : null,
    range: rangeMatch ? rangeMatch[1] : null,
    normalized: normalized
  };
  
  // Only return if we have meaningful identifying info
  if (!keys.lot && !keys.block && !keys.subdivision && !keys.section) {
    return null;
  }
  
  return keys;
}

/**
 * Check if two legal descriptions refer to the same property.
 * STRICT matching - requires subdivision/addition names to match when present.
 */
function legalDescriptionsMatch(desc1, desc2) {
  if (!desc1 || !desc2) return false;
  
  const norm1 = normalizeLegalDescription(desc1);
  const norm2 = normalizeLegalDescription(desc2);
  
  if (!norm1 || !norm2) return false;
  
  // Exact normalized match
  if (norm1 === norm2) return true;
  
  // One contains the other (handles truncated descriptions)
  if (norm1.length > 20 && norm2.length > 20) {
    if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
  }
  
  // Extract subdivision/addition names - this is the KEY identifier
  const getSubdivisionName = (normalized) => {
    // Match common patterns for subdivision names
    const patterns = [
      /([a-z]+(?:\s+[a-z]+)*)\s+(?:subdivision|s\s*d|sub|addition|add|#\d+)/i,
      /([a-z]+(?:\s+[a-z]+)*)\s+(?:estates|heights|hills|park|place|acres|ranch|plat|farms|village|manor|terrace|court|grove)/i,
    ];
    
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match && match[1] && match[1].length > 2) {
        return match[1].trim();
      }
    }
    return null;
  };
  
  const sub1 = getSubdivisionName(norm1);
  const sub2 = getSubdivisionName(norm2);
  
  // If EITHER has a subdivision name, they must match
  if (sub1 || sub2) {
    if (!sub1 || !sub2) return false; // One has it, other doesn't
    
    // Subdivisions must match (allowing one to contain the other)
    const s1 = sub1.toLowerCase().replace(/\s+/g, '');
    const s2 = sub2.toLowerCase().replace(/\s+/g, '');
    if (s1 !== s2 && !s1.includes(s2) && !s2.includes(s1)) {
      return false;
    }
  }
  
  // Now check lot and block
  const keys1 = extractLegalDescriptionKeys(desc1);
  const keys2 = extractLegalDescriptionKeys(desc2);
  
  // If we have lot and block for both, they must match
  if (keys1 && keys2 && keys1.lot && keys2.lot && keys1.block && keys2.block) {
    if (keys1.lot !== keys2.lot || keys1.block !== keys2.block) return false;
    return true; // Subdivision already matched above
  }
  
  // For rural property: section + township + range must match
  if (keys1 && keys2 && keys1.section && keys2.section) {
    return keys1.section === keys2.section &&
           keys1.township === keys2.township &&
           keys1.range === keys2.range;
  }
  
  // If no structured components could be extracted, require very high text similarity
  // Only match if one is substantially contained in the other
  if (norm1.length > 10 && norm2.length > 10) {
    const shorter = norm1.length < norm2.length ? norm1 : norm2;
    const longer = norm1.length < norm2.length ? norm2 : norm1;
    // Shorter must be at least 80% of longer and fully contained
    if (shorter.length >= longer.length * 0.8 && longer.includes(shorter)) {
      return true;
    }
  }
  
  return false;;
}

/**
 * Normalize party names for comparison by removing punctuation, 
 * extra whitespace, and standardizing format.
 */
function normalizePartyForComparison(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[,;."'()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if there's any overlap between two party lists.
 * Uses fuzzy matching to handle variations in how names are recorded.
 * Returns true if at least one person/entity appears in both lists.
 */
function partiesHaveOverlap(parties1, parties2) {
  const normalizeParty = (p) => {
    return normalizePartyForComparison(p)
      .replace(/\b(llc|inc|incorporated|corporation|corp|company|co|ltd|limited|trust|estate)\b/gi, '')
      .replace(/\b(the|a|an)\b/gi, '')
      .trim();
  };
  
  const list1 = parties1.split(';').map(p => normalizeParty(p)).filter(Boolean);
  const list2 = parties2.split(';').map(p => normalizeParty(p)).filter(Boolean);
  
  if (list1.length === 0 || list2.length === 0) return false;
  
  // Check for exact matches after normalization
  const set1 = new Set(list1);
  for (const party of list2) {
    if (set1.has(party)) return true;
  }
  
  // Check for partial matches (one name contains the other)
  // This helps with variations like "John Smith" vs "John D Smith"
  for (const p1 of list1) {
    for (const p2 of list2) {
      if (p1.length >= 5 && p2.length >= 5) {
        // Extract last names and compare
        const words1 = p1.split(' ');
        const words2 = p2.split(' ');
        const lastName1 = words1[words1.length - 1];
        const lastName2 = words2[words2.length - 1];
        
        // If last names match and first names start the same, consider it overlap
        if (lastName1 === lastName2 && lastName1.length >= 3) {
          if (words1[0] && words2[0] && words1[0][0] === words2[0][0]) {
            return true;
          }
        }
      }
    }
  }
  
  return false;
}

/**
 * Check if two party lists represent the same people.
 * Splits by semicolon and checks if all parties match (order-independent).
 */
function partiesMatch(parties1, parties2) {
  const set1 = new Set(
    parties1.split(';').map(p => normalizePartyForComparison(p)).filter(Boolean)
  );
  const set2 = new Set(
    parties2.split(';').map(p => normalizePartyForComparison(p)).filter(Boolean)
  );
  
  if (set1.size === 0 || set2.size === 0) return false;
  if (set1.size !== set2.size) return false;
  
  for (const party of set1) {
    if (!set2.has(party)) return false;
  }
  return true;
}

/**
 * Filter chain documents to only include actual ownership transfers (deeds, etc.).
 * Builds a logical ownership chain by following grantor→grantee relationships.
 * Excludes mortgages, liens, and documents without proper grantor/grantee info.
 */
export function filterOwnershipChanges(chainDocs) {
  if (!chainDocs || chainDocs.length === 0) return [];

  // Document types that represent ownership transfers (deeds only)
  // Include both full names and common abbreviations
  const ownershipTransferTypes = [
    'deed',
    'warranty deed',
    'special warranty deed',
    'quit claim deed',
    'quitclaim deed',
    'grant deed',
    'executor deed',
    'trustee deed',
    'administrator deed',
    'marshal deed',
    'sheriff deed',
    'tax deed',
    // Common abbreviations
    'wd',   // Warranty Deed
    'swd',  // Special Warranty Deed
    'qcd',  // Quit Claim Deed
    'gd',   // Grant Deed
    'td'    // Tax Deed (but not "dt" which is deed of trust)
  ];

  // Explicitly exclude deeds of trust and other non-ownership documents
  const excludedTypes = [
    'deed of trust',
    'deeds of trust',
    'trust deed',
    'dt',   // Deed of Trust abbreviation
    'd/t',  // Deed of Trust abbreviation
    'dot',  // Deed of Trust abbreviation
    'mortgage',
    'mtg',
    'lien',
    'assignment',
    'release',
    'partial release',
    'pr',   // Partial Release
    'rel',  // Release
    'subordination',
    'sub'   // Subordination
  ];

  const isOwnershipTransfer = (doc) => {
    if (!doc.instrumentType) return false;
    const type = doc.instrumentType.toLowerCase().trim();
    
    // First check exclusions (more specific)
    const isExcluded = excludedTypes.some(t => type === t || type.includes(t));
    if (isExcluded) {
      console.log(`[filterOwnership] Excluded "${doc.instrumentType}" (type: ${type})`);
      return false;
    }
    
    // Then check if it's an ownership transfer
    // For abbreviations, require exact match; for full names, use includes
    const isTransfer = ownershipTransferTypes.some(t => {
      if (t.length <= 3) {
        // Short abbreviation - require exact match or match with spaces
        return type === t || type.startsWith(t + ' ') || type.endsWith(' ' + t);
      }
      return type.includes(t);
    });
    
    console.log(`[filterOwnership] "${doc.instrumentType}" (type: ${type}) → ${isTransfer ? 'INCLUDED' : 'not a deed'}`);
    return isTransfer;
  };

  // Filter to docs with valid grantees/grantors and ownership transfer types
  const validDocs = chainDocs.filter(doc => {
    const grantees = ensureString(doc.grantees).trim();
    const grantors = ensureString(doc.grantors).trim();
    const hasParties = grantees && grantors;
    const isTransfer = isOwnershipTransfer(doc);
    
    if (hasParties && !isTransfer) {
      console.log(`[filterOwnership] Doc has parties but not transfer type: "${doc.instrumentType}"`);
    }
    
    return hasParties && isTransfer;
  });
  
  console.log(`[filterOwnership] Found ${validDocs.length} ownership transfers out of ${chainDocs.length} chain docs`);

  if (validDocs.length === 0) return [];
  if (validDocs.length === 1) return validDocs;

  // Build ownership chain using graph-based approach
  // Each document is a node, edges connect docs where grantee→grantor
  const usedDocs = new Set();
  const ownershipChain = [];
  
  // Helper to find best starting document (earliest OR most connected)
  function findBestStart(docs, used) {
    let bestDoc = null;
    let bestConnections = -1;
    
    for (const doc of docs) {
      if (used.has(doc.documentID)) continue;
      
      // Count how many other docs this connects to
      const docGrantees = ensureString(doc.grantees);
      let connections = 0;
      
      for (const other of docs) {
        if (other.documentID === doc.documentID) continue;
        const otherGrantors = ensureString(other.grantors);
        if (partiesHaveOverlap(docGrantees, otherGrantors)) {
          connections++;
        }
      }
      
      if (bestDoc === null || connections > bestConnections) {
        bestDoc = doc;
        bestConnections = connections;
      }
    }
    
    return bestDoc;
  }
  
  // Strategy 1: Follow party relationships to build chain
  let currentDoc = validDocs[0]; // Start with earliest
  ownershipChain.push(currentDoc);
  usedDocs.add(currentDoc.documentID);
  
  const seenGranteeSets = new Set();
  seenGranteeSets.add(ensureString(currentDoc.grantees).toLowerCase());
  
  let changed = true;
  while (changed) {
    changed = false;
    const currentGrantees = ensureString(currentDoc.grantees);
    
    // Find next document where grantors overlap with current grantees
    for (const nextDoc of validDocs) {
      if (usedDocs.has(nextDoc.documentID)) continue;
      
      const nextGrantors = ensureString(nextDoc.grantors);
      const nextGrantees = ensureString(nextDoc.grantees);
      const nextGranteesLower = nextGrantees.toLowerCase();
      
      // Skip if we've already seen these grantees
      if (seenGranteeSets.has(nextGranteesLower)) continue;
      
      if (partiesHaveOverlap(currentGrantees, nextGrantors)) {
        // Make sure ownership is actually changing
        if (!partiesMatch(currentGrantees, nextGrantees)) {
          ownershipChain.push(nextDoc);
          usedDocs.add(nextDoc.documentID);
          seenGranteeSets.add(nextGranteesLower);
          currentDoc = nextDoc;
          changed = true;
          break;
        }
      }
    }
  }
  
  // Strategy 2: If chain is short, add remaining unique grantees chronologically
  // This handles disconnected chains or missing intermediate owners
  if (ownershipChain.length < validDocs.length / 2 || ownershipChain.length < 3) {
    for (const doc of validDocs) {
      if (usedDocs.has(doc.documentID)) continue;
      
      const grantees = ensureString(doc.grantees);
      const granteesLower = grantees.toLowerCase();
      
      // Only add if we haven't seen these grantees
      if (!seenGranteeSets.has(granteesLower)) {
        ownershipChain.push(doc);
        usedDocs.add(doc.documentID);
        seenGranteeSets.add(granteesLower);
      }
    }
    
    // Re-sort by date after adding
    ownershipChain.sort((a, b) => {
      const dateA = new Date(a.filingDate || a.fileStampDate || 0);
      const dateB = new Date(b.filingDate || b.fileStampDate || 0);
      return dateA - dateB;
    });
  }

  return ownershipChain;
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

// Helper to ensure value is a string (handles arrays, nulls, objects, etc)
function ensureString(val) {
  if (typeof val === 'string') return val;
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return val.join('; ');
  if (typeof val === 'object') {
    // If it's an object, try to extract meaningful data or return empty
    return '';
  }
  return String(val);
}

function buildHeuristicChainNarrative(chainDocs) {
  if (!chainDocs || chainDocs.length === 0) return '';

  // Filter to only ownership changes to reduce narrative size
  const ownershipChanges = filterOwnershipChanges(chainDocs);

  if (ownershipChanges.length === 0) return 'No ownership changes found.';

  const narrative = ownershipChanges.map((doc, idx) => {
    const grantorStr = ensureString(doc.grantors);
    const granteeStr = ensureString(doc.grantees);
    const grantors = grantorStr ? grantorStr.split('; ') : [];
    const grantees = granteeStr ? granteeStr.split('; ') : [];
    const fromText = grantors.length > 0 ? grantors.join(' and ') : 'Unknown';
    const toText = grantees.length > 0 ? grantees.join(' and ') : 'Unknown';
    const date = formatDate(doc.filingDate) || 'Unknown date';
    const type = doc.instrumentType || 'Document';
    const bookRef = doc.book ? ` (Recorded: Book ${doc.book}, Volume ${doc.volume}, Page ${doc.page})` : '';

    return `${idx + 1}. On ${date}, ownership transferred from ${fromText} to ${toText} via ${type}.${bookRef}`;
  }).join('\n\n');

  return narrative;
}

function normalizePartyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/["'()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPartyCandidates(text) {
  const candidates = new Set();
  if (!text) return candidates;

  const patterns = [
    /\bfrom\s+([^\n.,;]+?)\s+to\s+([^\n.,;]+?)(?:\s+via|\s+on|\.|,|$)/gi,
    /\btransferred\s+(?:the property\s+)?from\s+([^\n.,;]+?)\s+to\s+([^\n.,;]+?)(?:\s+via|\s+on|\.|,|$)/gi,
    /\btransferred\s+(?:the property\s+)?to\s+([^\n.,;]+?)(?:\s+via|\s+on|\.|,|$)/gi,
    /\bgrantor\s*:\s*([^\n.,;]+)/gi,
    /\bgrantee\s*:\s*([^\n.,;]+)/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      for (let i = 1; i < match.length; i++) {
        const value = match[i];
        if (!value) continue;
        const parts = value.split(/\s*(?:;|,|\band\b|&)\s*/i);
        for (const part of parts) {
          const normalized = normalizePartyName(part);
          if (normalized) candidates.add(normalized);
        }
      }
    }
  }

  return candidates;
}

function validateAiOutput(parsed, docsForAnalysis, propertyInfo) {
  const allowedParties = new Set();
  const allowedDates = new Set();

  for (const doc of docsForAnalysis) {
    const grantors = ensureString(doc.grantors);
    const grantees = ensureString(doc.grantees);
    const date = formatDate(doc.filingDate) || 'Unknown date';

    allowedDates.add(date);

    const partyGroups = [grantors, grantees];
    for (const group of partyGroups) {
      if (!group) continue;
      const parts = group.split('; ');
      for (const part of parts) {
        const normalized = normalizePartyName(part);
        if (normalized) allowedParties.add(normalized);
      }
    }
  }

  const text = [parsed?.narrative, parsed?.analysis, parsed?.concerns]
    .filter(Boolean)
    .join('\n');

  // Check for wrong property descriptions (AI hallucination)
  const propertyLegal = propertyInfo?.legalDescription?.toLowerCase() || '';
  if (propertyLegal) {
    // Extract words that look like subdivision names in AI output
    const subdivisionPatterns = [
      /([a-z]+(?:\s+[a-z]+)*)\s+(?:subdivision|addition|estates|heights|hills|acres|farms|village)/gi
    ];
    
    for (const pattern of subdivisionPatterns) {
      let match;
      while ((match = pattern.exec(text.toLowerCase())) !== null) {
        const mentioned = match[1]?.trim();
        if (mentioned && mentioned.length > 3) {
          // Check if this subdivision name appears in the actual property legal description
          if (!propertyLegal.includes(mentioned.replace(/\s+/g, ' '))) {
            // It might be a hallucinated property - reject
            return { ok: false, reason: `AI mentioned property "${mentioned}" which doesn't match the actual property` };
          }
        }
      }
    }
  }

  const dateRegex = /\b\d{4}-\d{2}-\d{2}\b/g;
  const dates = text.match(dateRegex) || [];
  for (const date of dates) {
    if (!allowedDates.has(date)) {
      return { ok: false, reason: `Unrecognized date in AI output: ${date}` };
    }
  }

  const partyCandidates = extractPartyCandidates(text);
  for (const candidate of partyCandidates) {
    if (candidate === 'unknown' || candidate === 'not provided') continue;
    if (!allowedParties.has(candidate)) {
      return { ok: false, reason: `Unrecognized party in AI output: ${candidate}` };
    }
  }

  return { ok: true };
}

export async function generateChainAnalysis(chainDocs, propertyInfo) {
  try {
    // Filter to only ownership changes before analysis to keep size manageable
    const ownershipDocs = filterOwnershipChanges(chainDocs);
    
    // If no ownership documents found, return informative message
    if (ownershipDocs.length === 0) {
      return {
        narrative: 'No deed transfers found for this property. The search may need to be expanded or the property may not have recorded ownership documents in this system.',
        analysis: 'Chain of title analysis cannot be performed without deed documents.',
        concerns: 'No deed records found. This could indicate: missing records, incorrect legal description, or property may be newly platted.',
        source: 'heuristic'
      };
    }
    
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

      // Don't include individual doc legal descriptions - use only propertyInfo
      return `Step ${idx + 1}:\n` +
        `  Date: ${date}\n` +
        `  From (Grantor): ${grantors}\n` +
        `  To (Grantee): ${grantees}\n` +
        `  Type: ${type}\n` +
        `  Reference: Book/Vol/Page ${bookRef}`;
    }).join('\n\n');

    const prompt = `You are a legal title abstractor. Use ONLY the data provided below.
  Do NOT add facts, names, dates, locations, or legal conclusions that are not explicitly present.
  CRITICAL: The property legal description is "${truncateText(propertyInfo?.legalDescription, 500)}". Use EXACTLY this description - do not modify, summarize, or substitute it.
  If a detail is missing, state "Unknown" or "Not provided" and do not infer it.
  Do not speculate about unrecorded documents or intent.

  For the "narrative" field: Describe each ownership transfer below. Reference the property as "${truncateText(propertyInfo?.legalDescription, 100)}" exactly - do not use any other property description.
  
  For the "analysis" field: Provide a brief assessment of chain continuity in plain text.
  
  For the "concerns" field: If there are concerns, state them briefly. Otherwise write "None identified."

  Chain of Title (ownership changes only):
  ${docSummaries}

  Property:
  Legal Description: ${truncateText(propertyInfo?.legalDescription, 500)}
  Address: ${propertyInfo?.address || 'Not provided'}

  Respond in JSON format with exactly these keys: narrative, analysis, concerns
  IMPORTANT: The values of these keys must be plain text strings, NOT nested JSON objects or arrays.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'You are a legal title abstractor. Only use the provided data. Be concise and strictly factual. Never guess or infer missing information.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    
    // Validate that AI returned strings, not objects or arrays
    if (typeof parsed.narrative !== 'string' || typeof parsed.analysis !== 'string') {
      console.warn('AI returned non-string fields, rejecting and using heuristic');
      return {
        narrative: buildHeuristicChainNarrative(chainDocs),
        analysis: 'Chain of title generated from document records.',
        concerns: '',
        source: 'heuristic'
      };
    }
    
    const validation = validateAiOutput(parsed, docsForAnalysis, propertyInfo);
    if (!validation.ok) {
      console.warn('AI chain analysis rejected:', validation.reason);
      return {
        narrative: buildHeuristicChainNarrative(chainDocs),
        analysis: 'Chain of title generated from document records.',
        concerns: '',
        source: 'heuristic'
      };
    }
    
    return {
      narrative: parsed.narrative || 'No narrative provided.',
      analysis: parsed.analysis || 'No analysis provided.',
      concerns: typeof parsed.concerns === 'string' ? parsed.concerns : '',
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

// Broad query to find candidate documents - we'll filter in JavaScript
// Using LOWER() for case-insensitive matching
const CANDIDATE_DOCS_BY_LEGAL_QUERY = `
  SELECT d.*, c.name AS countyName,
         GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees,
         GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors
  FROM Document d
  LEFT JOIN County c ON c.countyID = d.countyID
  LEFT JOIN Party p ON p.documentID = d.documentID
  WHERE d.countyID = ? AND d.legalDescription IS NOT NULL AND d.legalDescription != ''
    AND LOWER(d.legalDescription) LIKE LOWER(?)
  GROUP BY d.documentID
  ORDER BY d.filingDate ASC, d.fileStampDate ASC
`;

const CANDIDATE_DOCS_BY_ADDRESS_QUERY = `
  SELECT d.*, c.name AS countyName,
         GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees,
         GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors
  FROM Document d
  LEFT JOIN County c ON c.countyID = d.countyID
  LEFT JOIN Party p ON p.documentID = d.documentID
  WHERE d.countyID = ? AND d.address IS NOT NULL AND d.address != ''
    AND LOWER(TRIM(d.address)) = LOWER(TRIM(?))
  GROUP BY d.documentID
  ORDER BY d.filingDate ASC, d.fileStampDate ASC
`;

// Query to find documents by party names (for chain building)
const DOCS_BY_PARTY_QUERY = `
  SELECT d.*, c.name AS countyName,
         GROUP_CONCAT(CASE WHEN p2.role = 'Grantee' THEN p2.name END SEPARATOR '; ') AS grantees,
         GROUP_CONCAT(CASE WHEN p2.role = 'Grantor' THEN p2.name END SEPARATOR '; ') AS grantors
  FROM Document d
  LEFT JOIN County c ON c.countyID = d.countyID
  LEFT JOIN Party p ON p.documentID = d.documentID
  LEFT JOIN Party p2 ON p2.documentID = d.documentID
  WHERE d.countyID = ? 
    AND p.name LIKE ?
  GROUP BY d.documentID
  ORDER BY d.filingDate ASC, d.fileStampDate ASC
`;

/**
 * Build a SQL LIKE pattern from a legal description.
 * Includes subdivision name to narrow down results.
 * Filtering is done in JavaScript for accuracy.
 */
function buildLegalDescSearchPattern(legalDesc) {
  if (!legalDesc || !legalDesc.trim()) return null;
  
  const normalized = normalizeLegalDescription(legalDesc);
  
  // Extract subdivision/addition name first - this is the most specific identifier
  const getSubdivisionKeyword = (text) => {
    const patterns = [
      /([a-z]+(?:\s+[a-z]+)*)\s+(?:subdivision|s\s*d|sub|addition|add)/i,
      /([a-z]+(?:\s+[a-z]+)*)\s+(?:estates|heights|hills|park|place|acres|ranch|plat|farms|village|manor)/i,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].length > 3) {
        // Get first significant word of subdivision name
        const words = match[1].trim().split(/\s+/);
        const keyword = words.find(w => w.length > 3);
        return keyword || words[0];
      }
    }
    return null;
  };
  
  const subdivisionKeyword = getSubdivisionKeyword(normalized);
  const lotMatch = normalized.match(/lot\s*(\d+)/i);
  const blockMatch = normalized.match(/block\s*(\d+)/i);
  
  // Best case: have subdivision + lot + block
  if (subdivisionKeyword && lotMatch && blockMatch) {
    return `%${subdivisionKeyword}%lot%${lotMatch[1]}%${blockMatch[1]}%`;
  }
  
  // Have subdivision + lot
  if (subdivisionKeyword && lotMatch) {
    return `%${subdivisionKeyword}%lot%${lotMatch[1]}%`;
  }
  
  // Have just subdivision name - search by that
  if (subdivisionKeyword) {
    return `%${subdivisionKeyword}%`;
  }
  
  // Fallback: lot + block without subdivision
  if (lotMatch && blockMatch) {
    return `%lot%${lotMatch[1]}%${blockMatch[1]}%`;
  }
  
  // Just lot
  if (lotMatch) {
    return `%lot%${lotMatch[1]}%`;
  }
  
  // Try section for rural properties
  const sectionMatch = normalized.match(/section\s*(\d+)/i);
  if (sectionMatch) {
    return `%section%${sectionMatch[1]}%`;
  }
  
  // Last resort: use first 20 chars
  if (legalDesc.trim().length >= 5) {
    return `%${legalDesc.trim().substring(0, 20)}%`;
  }
  
  return null;
}

/**
 * Fetch chain documents using multiple strategies.
 * 
 * Strategy 1: Match by legal description (normalized comparison)
 * Strategy 2: Match by address
 * Strategy 3: Fallback - ensure starting document is included
 * 
 * The results are filtered in JavaScript to ensure accurate matching.
 */
export async function fetchChainDocsByLegalOrAddress(pool, propertyInfo) {
  const legalDesc = propertyInfo.legalDescription || '';
  const address = propertyInfo.address || '';
  const countyID = propertyInfo.countyID;
  const startingDocID = propertyInfo.documentID;
  
  console.log(`[ChainOfTitle] Starting search for doc ${startingDocID}, countyID: ${countyID}`);
  console.log(`[ChainOfTitle] Legal desc: "${legalDesc?.substring(0, 50)}..."`);
  console.log(`[ChainOfTitle] Address: "${address}"`);
  
  let allCandidates = [];
  let startingDocIncluded = false;
  
  // Strategy 1: Search by legal description pattern
  if (legalDesc.trim()) {
    const searchPattern = buildLegalDescSearchPattern(legalDesc);
    console.log(`[ChainOfTitle] Built search pattern: ${searchPattern}`);
    
    if (searchPattern) {
      try {
        const [results] = await pool.query(CANDIDATE_DOCS_BY_LEGAL_QUERY, [countyID, searchPattern]);
        console.log(`[ChainOfTitle] SQL returned ${results?.length || 0} candidates`);
        
        if (results && results.length > 0) {
          // Filter to documents that actually match this property
          const filtered = results.filter(doc => {
            const matches = legalDescriptionsMatch(legalDesc, doc.legalDescription);
            if (!matches) {
              console.log(`[ChainOfTitle] Rejected: "${doc.legalDescription?.substring(0, 30)}..."`);
            }
            return matches;
          });
          console.log(`[ChainOfTitle] After JS filtering: ${filtered.length} matches`);
          allCandidates = [...filtered];
          
          // Check if starting doc is in results
          startingDocIncluded = allCandidates.some(d => d.documentID === startingDocID);
        }
      } catch (err) {
        console.error('[ChainOfTitle] Legal description search failed:', err);
      }
    }
  }
  
  // Strategy 2: Search by address if we didn't find much
  if (allCandidates.length < 2 && address.trim()) {
    try {
      console.log(`[ChainOfTitle] Trying address search...`);
      const [results] = await pool.query(CANDIDATE_DOCS_BY_ADDRESS_QUERY, [countyID, address.trim()]);
      console.log(`[ChainOfTitle] Address search returned ${results?.length || 0} results`);
      
      if (results && results.length > 0) {
        // Add any documents not already in our list
        const existingIds = new Set(allCandidates.map(d => d.documentID));
        for (const doc of results) {
          if (!existingIds.has(doc.documentID)) {
            // Only add if legal description also matches OR legal desc is empty
            if (!legalDesc.trim() || !doc.legalDescription || legalDescriptionsMatch(legalDesc, doc.legalDescription)) {
              allCandidates.push(doc);
              if (doc.documentID === startingDocID) startingDocIncluded = true;
            }
          }
        }
      }
    } catch (err) {
      console.error('[ChainOfTitle] Address search failed:', err);
    }
  }
  
  // Strategy 3: ALWAYS ensure starting document is included
  if (!startingDocIncluded && startingDocID) {
    try {
      console.log(`[ChainOfTitle] Fetching starting document ${startingDocID} as fallback`);
      const SINGLE_DOC_QUERY = `
        SELECT d.*, c.name AS countyName,
               GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees,
               GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors
        FROM Document d
        LEFT JOIN County c ON c.countyID = d.countyID
        LEFT JOIN Party p ON p.documentID = d.documentID
        WHERE d.documentID = ?
        GROUP BY d.documentID
      `;
      const [startDocs] = await pool.query(SINGLE_DOC_QUERY, [startingDocID]);
      if (startDocs && startDocs.length > 0) {
        console.log(`[ChainOfTitle] Added starting document`);
        allCandidates.push(startDocs[0]);
        startingDocIncluded = true;
      }
    } catch (err) {
      console.error('[ChainOfTitle] Failed to fetch starting document:', err);
    }
  }
  
  // Sort by filing date
  allCandidates.sort((a, b) => {
    const dateA = new Date(a.filingDate || a.fileStampDate || 0);
    const dateB = new Date(b.filingDate || b.fileStampDate || 0);
    return dateA - dateB;
  });
  
  console.log(`[ChainOfTitle] Returning ${allCandidates.length} total documents`);
  return allCandidates;
}

/**
 * Fetch chain docs for PDF - uses same multi-strategy approach.
 */
export async function fetchChainDocs(pool, propertyInfo) {
  return fetchChainDocsByLegalOrAddress(pool, propertyInfo);
}

/**
 * Generate Schedule B exceptions from chain documents.
 * Schedule B exceptions are items that affect title but are not covered by title insurance.
 * This includes: mortgages/deeds of trust, easements, liens, restrictions, etc.
 */
export function generateScheduleBExceptions(chainDocs) {
  if (!chainDocs || chainDocs.length === 0) {
    return { exceptions: [], summary: 'No documents found to analyze for exceptions.' };
  }

  // Document types that represent Schedule B exceptions with detailed explanations
  const exceptionTypePatterns = {
    'Deed of Trust / Mortgage': {
      patterns: [
        'deed of trust', 'deeds of trust', 'trust deed', 'mortgage', 'mtg',
        'dt', 'd/t', 'dot', 'modification', 'mod'
      ],
      description: 'A security instrument that encumbers the property as collateral for a loan.',
      impact: 'MUST BE PAID OFF at closing or the lender retains the right to foreclose. Obtain payoff statement from lender.',
      actionRequired: 'Verify current balance, request payoff demand, ensure release/reconveyance is recorded after payoff.',
      priority: 'HIGH'
    },
    'Easement': {
      patterns: [
        'easement', 'esmt', 'right of way', 'row', 'utility easement',
        'access easement', 'pipeline easement', 'power line easement'
      ],
      description: 'A right granted to another party to use a portion of the property for a specific purpose.',
      impact: 'Permanent encumbrance that transfers with the property. May restrict building, landscaping, or use of affected area.',
      actionRequired: 'Review easement document to determine: location, width, purpose, and any maintenance obligations.',
      priority: 'MEDIUM'
    },
    'Lien': {
      patterns: [
        'lien', 'mechanics lien', 'mechanic\'s lien', 'materialman lien',
        'tax lien', 'federal tax lien', 'state tax lien', 'judgment lien',
        'lis pendens', 'hospital lien', 'child support lien'
      ],
      description: 'A legal claim against the property for unpaid debts or obligations.',
      impact: 'MUST BE RESOLVED before clear title can transfer. Lien holder can force sale of property to collect debt.',
      actionRequired: 'Obtain payoff amount, negotiate release, or arrange for payment at closing. Federal tax liens require IRS release.',
      priority: 'HIGH'
    },
    'Restriction / Covenant': {
      patterns: [
        'restriction', 'covenant', 'cc&r', 'ccr', 'declaration',
        'restrictive covenant', 'deed restriction', 'plat restriction'
      ],
      description: 'Rules and limitations on how the property can be used, often created by subdivisions or HOAs.',
      impact: 'Permanent restrictions that run with the land. May limit: building size, use type, landscaping, exterior colors, etc.',
      actionRequired: 'Review full document to understand all restrictions. Verify current compliance and any HOA fees/assessments.',
      priority: 'MEDIUM'
    },
    'Assignment': {
      patterns: [
        'assignment', 'assign', 'asgn', 'assignment of'
      ],
      description: 'Transfer of rights from one party to another, often related to mortgages or other encumbrances.',
      impact: 'Changes who holds rights to an existing encumbrance. The underlying obligation remains.',
      actionRequired: 'Track current holder of the underlying document (mortgage, lease, etc.) for payoff or release purposes.',
      priority: 'LOW'
    },
    'Subordination': {
      patterns: [
        'subordination', 'sub agreement', 'subordination agreement'
      ],
      description: 'Agreement that changes the priority order of liens or encumbrances.',
      impact: 'Affects which creditor gets paid first in case of default. Does not eliminate any debts.',
      actionRequired: 'Verify current lien positions and ensure proper priority for any new financing.',
      priority: 'LOW'
    },
    'UCC Financing Statement': {
      patterns: [
        'ucc', 'financing statement', 'ucc-1', 'ucc1'
      ],
      description: 'A filing that gives a creditor a security interest in personal property (fixtures, equipment, crops).',
      impact: 'May affect personal property attached to the real estate. Usually does not cloud title to the land itself.',
      actionRequired: 'Determine if filing covers fixtures. If so, obtain release or ensure payoff at closing.',
      priority: 'MEDIUM'
    },
    'Judgment': {
      patterns: [
        'judgment', 'judgement', 'abstract of judgment', 'court order'
      ],
      description: 'A court-ordered debt that has been recorded as a lien against the property.',
      impact: 'MUST BE SATISFIED or subordinated. Judgment creditor can force sale to collect. May accrue interest.',
      actionRequired: 'Obtain current balance with interest, negotiate satisfaction, or escrow funds for payment.',
      priority: 'HIGH'
    },
    'Lease': {
      patterns: [
        'lease', 'memorandum of lease', 'oil and gas lease', 'mineral lease'
      ],
      description: 'An agreement giving another party rights to use the property for a specified period.',
      impact: 'Tenant/lessee rights survive sale. Buyer takes property subject to existing lease terms.',
      actionRequired: 'Review lease terms, expiration date, rent amounts, and any purchase options. Verify tenant notice requirements.',
      priority: 'MEDIUM'
    },
    'Mineral Rights': {
      patterns: [
        'mineral', 'mineral rights', 'mineral reservation', 'royalty deed',
        'oil and gas', 'subsurface rights'
      ],
      description: 'Rights to extract minerals, oil, gas, or other subsurface resources from the property.',
      impact: 'Surface owner may not own what is beneath. Mineral rights holder may have access rights for extraction.',
      actionRequired: 'Determine what rights are severed, who owns them, and if any active extraction or leases exist.',
      priority: 'MEDIUM'
    },
    'Agreement': {
      patterns: [
        'agreement', 'boundary agreement', 'maintenance agreement',
        'shared driveway', 'party wall'
      ],
      description: 'A recorded agreement affecting the property, often involving shared facilities or boundaries.',
      impact: 'Creates ongoing obligations or shared rights with neighbors or other parties.',
      actionRequired: 'Review full agreement to understand responsibilities, cost-sharing, and any restrictions.',
      priority: 'LOW'
    }
  };

  // Release/satisfaction documents that may clear exceptions
  const releasePatterns = [
    'release', 'rel', 'satisfaction', 'reconveyance', 'full reconveyance',
    'partial release', 'pr', 'release of lien', 'discharge', 'cancellation'
  ];

  const exceptions = [];
  const releases = [];

  // Categorize each document
  for (const doc of chainDocs) {
    if (!doc.instrumentType) continue;
    const type = doc.instrumentType.toLowerCase().trim();
    
    // Check if this is a release document
    const isRelease = releasePatterns.some(p => type.includes(p));
    if (isRelease) {
      releases.push({
        documentID: doc.documentID,
        type: doc.instrumentType,
        date: doc.filingDate,
        grantors: ensureString(doc.grantors),
        grantees: ensureString(doc.grantees),
        book: doc.book,
        volume: doc.volume,
        page: doc.page
      });
      continue;
    }

    // Check against exception patterns
    for (const [category, info] of Object.entries(exceptionTypePatterns)) {
      const matches = info.patterns.some(p => type.includes(p));
      if (matches) {
        exceptions.push({
          documentID: doc.documentID,
          category,
          instrumentType: doc.instrumentType,
          filingDate: doc.filingDate,
          grantors: ensureString(doc.grantors),
          grantees: ensureString(doc.grantees),
          legalDescription: doc.legalDescription,
          book: doc.book,
          volume: doc.volume,
          page: doc.page,
          countyName: doc.countyName,
          // Include detailed info from pattern definition
          description: info.description,
          impact: info.impact,
          actionRequired: info.actionRequired,
          priority: info.priority
        });
        break; // Only categorize once
      }
    }
  }

  // Sort exceptions by priority (HIGH first), then by date
  const priorityOrder = { 'HIGH': 0, 'MEDIUM': 1, 'LOW': 2 };
  exceptions.sort((a, b) => {
    const priorityDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
    if (priorityDiff !== 0) return priorityDiff;
    const dateA = new Date(a.filingDate || 0);
    const dateB = new Date(b.filingDate || 0);
    return dateA - dateB;
  });

  // Generate summary
  const categoryCounts = {};
  const priorityCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const exc of exceptions) {
    categoryCounts[exc.category] = (categoryCounts[exc.category] || 0) + 1;
    priorityCounts[exc.priority] = (priorityCounts[exc.priority] || 0) + 1;
  }

  let summary = `Found ${exceptions.length} potential Schedule B exception(s)`;
  if (releases.length > 0) {
    summary += ` and ${releases.length} release/satisfaction document(s)`;
  }
  summary += '.';

  if (priorityCounts.HIGH > 0) {
    summary += ` ${priorityCounts.HIGH} HIGH priority item(s) require immediate attention.`;
  }

  if (Object.keys(categoryCounts).length > 0) {
    summary += ' Breakdown: ' + Object.entries(categoryCounts)
      .map(([cat, count]) => `${cat} (${count})`)
      .join(', ') + '.';
  }

  return {
    exceptions,
    releases,
    summary,
    categoryCounts
  };
}

/**
 * Generate AI-powered analysis of Schedule B exceptions.
 * @param {Array} exceptions - The categorized exceptions
 * @param {Array} releases - The release/satisfaction documents
 * @param {Object} propertyInfo - Property information
 * @returns {Object} AI analysis with narrative, recommendations, and concerns
 */
export async function generateScheduleBAnalysis(exceptions, releases, propertyInfo) {
  try {
    const apiKey = await getOpenAPIKey();
    if (!apiKey) {
      return generateHeuristicScheduleBAnalysis(exceptions, releases);
    }

    if (exceptions.length === 0) {
      return {
        narrative: 'No Schedule B exceptions were identified in the documents reviewed for this property.',
        recommendations: '',
        concerns: '',
        resolvedItems: [],
        unresolvedItems: [],
        source: 'heuristic'
      };
    }

    const openai = new OpenAI({ apiKey });

    // Prepare exception summaries for AI - only include actual data
    const exceptionSummaries = exceptions.map((exc, idx) => {
      const date = formatDate(exc.filingDate) || 'Unknown date';
      const bookRef = [exc.book, exc.volume, exc.page].filter(Boolean).join('/');
      return `Exception ${idx + 1}:
  Category: ${exc.category}
  Type: ${exc.instrumentType}
  Date: ${date}
  Recording: ${bookRef || 'Not specified'}
  From: ${exc.grantors || 'Unknown'}
  To: ${exc.grantees || 'Unknown'}
  Priority: ${exc.priority}`;
    }).join('\n\n');

    // Prepare release summaries
    const releaseSummaries = releases.length > 0 
      ? releases.map((rel, idx) => {
          const date = formatDate(rel.date) || 'Unknown date';
          const bookRef = [rel.book, rel.volume, rel.page].filter(Boolean).join('/');
          return `Release ${idx + 1}:
  Type: ${rel.type}
  Date: ${date}
  Recording: ${bookRef || 'Not specified'}
  Parties: ${rel.grantors || 'Unknown'} / ${rel.grantees || 'Unknown'}`;
        }).join('\n\n')
      : 'No release documents found.';

    // Extract all party names and document types for validation
    const validPartyNames = new Set();
    const validDocTypes = new Set();
    exceptions.forEach(exc => {
      if (exc.grantors) exc.grantors.split(/[;,]/).forEach(n => validPartyNames.add(n.trim().toLowerCase()));
      if (exc.grantees) exc.grantees.split(/[;,]/).forEach(n => validPartyNames.add(n.trim().toLowerCase()));
      if (exc.instrumentType) validDocTypes.add(exc.instrumentType.toLowerCase());
    });
    releases.forEach(rel => {
      if (rel.grantors) rel.grantors.split(/[;,]/).forEach(n => validPartyNames.add(n.trim().toLowerCase()));
      if (rel.grantees) rel.grantees.split(/[;,]/).forEach(n => validPartyNames.add(n.trim().toLowerCase()));
      if (rel.type) validDocTypes.add(rel.type.toLowerCase());
    });

    const prompt = `You are analyzing Schedule B exceptions. Use ONLY the exact data provided below.

CRITICAL RULES:
- ONLY reference parties, dates, document types, and recording info that appear in the data below
- DO NOT invent, assume, or speculate about ANY information not explicitly provided
- DO NOT add details about loan amounts, interest rates, property values, or other specifics not in the data
- If something is unknown or not provided, say "not specified" - do not guess
- Keep responses factual and brief

EXCEPTIONS DATA:
${exceptionSummaries}

RELEASES DATA:
${releaseSummaries}

Respond with JSON containing:
1. "narrative" - Brief summary (2-3 sentences) of what exceptions exist. ONLY mention what is in the data above.
2. "recommendations" - Generic action items based on the exception TYPES found (e.g., "obtain payoff for mortgages"). Do not reference specific parties or amounts unless in the data.
3. "concerns" - Only mention concerns that are DIRECTLY evident from the data (e.g., "no release found for the mortgage"). Do not speculate.

Keep all responses short and factual. When in doubt, omit rather than guess.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'You are a factual data summarizer. Only state facts from the provided data. Never invent information. Keep responses brief.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    
    // Validate that the response doesn't contain hallucinated party names
    // by checking for names that weren't in our input data
    const responseText = JSON.stringify(parsed).toLowerCase();
    
    // Simple validation - if response is too long or contains suspicious patterns, use heuristic
    if (parsed.narrative && parsed.narrative.length > 500) {
      console.warn('[Schedule B] AI narrative too long, using heuristic');
      return generateHeuristicScheduleBAnalysis(exceptions, releases);
    }
    
    return {
      narrative: parsed.narrative || generateHeuristicScheduleBAnalysis(exceptions, releases).narrative,
      recommendations: parsed.recommendations || '',
      concerns: parsed.concerns || '',
      resolvedItems: [],
      unresolvedItems: [],
      source: 'ai'
    };
  } catch (err) {
    console.error('AI Schedule B analysis failed:', err);
    return generateHeuristicScheduleBAnalysis(exceptions, releases);
  }
}

/**
 * Generate heuristic (non-AI) Schedule B analysis as fallback.
 * Only states facts from the actual exception data - no speculation.
 */
function generateHeuristicScheduleBAnalysis(exceptions, releases) {
  const highPriority = exceptions.filter(e => e.priority === 'HIGH');
  const mediumPriority = exceptions.filter(e => e.priority === 'MEDIUM');
  
  let narrative = '';
  if (exceptions.length === 0) {
    narrative = 'No Schedule B exceptions were identified in the documents reviewed.';
  } else {
    // Build factual summary from actual categories found
    const categories = [...new Set(exceptions.map(e => e.category))];
    narrative = `${exceptions.length} potential exception(s) found: ${categories.join(', ')}.`;
    if (highPriority.length > 0) {
      narrative += ` ${highPriority.length} high-priority.`;
    }
  }

  // Only mention recommendation types that match actual exceptions found
  let recommendations = '';
  const hasLiens = highPriority.some(e => 
    e.category.includes('Mortgage') || e.category.includes('Trust') || 
    e.category.includes('Lien') || e.category.includes('Judgment')
  );
  if (hasLiens) {
    recommendations = 'Obtain payoff information for any outstanding liens before closing.';
  }

  const concerns = highPriority.length > 0 
    ? `${highPriority.length} high-priority item(s) identified.`
    : '';

  return {
    narrative,
    recommendations,
    concerns,
    resolvedItems: [],
    unresolvedItems: exceptions.map(e => `${e.category}: ${e.instrumentType} dated ${formatDate(e.filingDate) || 'Unknown'}`),
    source: 'heuristic'
  };
}
