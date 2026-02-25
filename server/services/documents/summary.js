import { getOpenAPIKey } from '../../config.js';
import OpenAI from 'openai';
import { formatDate, truncateText } from '../../lib/format.js';

export function buildHeuristicSummary(doc) {
  const instrument = doc.instrumentType ? `${doc.instrumentType}` : 'Recorded document';
  const bookRef = [doc.book, doc.volume, doc.page].filter(Boolean).join('/');
  const bookText = bookRef ? `Book/Vol/Page ${bookRef}` : null;
  const filingDate = formatDate(doc.filingDate);
  const county = doc.countyName ? `${doc.countyName} County` : null;
  const parties = [doc.grantors, doc.grantees].filter(Boolean).join(' → ');
  const legal = truncateText(doc.legalDescription, 240);

  const sentence1Parts = [instrument, bookText, filingDate ? `filed ${filingDate}` : null, county ? `in ${county}` : null]
    .filter(Boolean)
    .join(', ');

  const sentence2Parts = [parties ? `Parties: ${parties}` : null, legal ? `Legal: ${legal}` : null]
    .filter(Boolean)
    .join('. ');

  const sentence1 = sentence1Parts ? `${sentence1Parts}.` : '';
  const sentence2 = sentence2Parts ? `${sentence2Parts}.` : '';

  return [sentence1, sentence2].filter(Boolean).join(' ');
}

export async function generateAiSummary(doc) {
  try {
    const apiKey = await getOpenAPIKey();
    if (!apiKey) {
      return { summary: buildHeuristicSummary(doc) || '—', source: 'heuristic' };
    }

    const openai = new OpenAI({ apiKey });

    const lines = [];
    lines.push(`Document ID: ${doc.documentID}`);
    if (doc.instrumentType) lines.push(`Instrument Type: ${doc.instrumentType}`);
    if (doc.instrumentNumber) lines.push(`Instrument Number: ${doc.instrumentNumber}`);
    const bookRef = [doc.book, doc.volume, doc.page].filter(Boolean).join('/');
    if (bookRef) lines.push(`Book/Volume/Page: ${bookRef}`);
    if (doc.filingDate) lines.push(`Filing Date: ${formatDate(doc.filingDate)}`);
    if (doc.fileStampDate) lines.push(`File Stamp Date: ${formatDate(doc.fileStampDate)}`);
    if (doc.countyName) lines.push(`County: ${doc.countyName}`);
    if (doc.grantors) lines.push(`Grantor(s): ${doc.grantors}`);
    if (doc.grantees) lines.push(`Grantee(s): ${doc.grantees}`);
    if (doc.remarks) lines.push(`Remarks: ${truncateText(doc.remarks, 800)}`);
    if (doc.address) lines.push(`Address: ${doc.address}`);
    if (doc.legalDescription) lines.push(`Legal Description: ${truncateText(doc.legalDescription, 2000)}`);
    if (doc.abstractText) lines.push(`Abstract Text: ${truncateText(doc.abstractText, 1200)}`);

    const input = lines.join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a title examiner assistant. Produce a concise 2-3 sentence summary using only the provided fields. No speculation, no headings, no bullet points. Keep it under 400 characters.'
        },
        {
          role: 'user',
          content: input
        }
      ]
    });

    const parsed = JSON.parse(response.choices[0].message.content || '{}');
    const summary = (parsed?.summary || '').toString().trim();
    if (summary) {
      return { summary, source: 'ai' };
    }
  } catch (err) {
    console.error('AI summary failed:', err);
  }

  return { summary: buildHeuristicSummary(doc) || '—', source: 'heuristic' };
}
