/** Must match [python/opensearch_index_documents.py](python/opensearch_index_documents.py) INDEX_NAME and text fields. */

export const OPENSEARCH_INDEX_DOCUMENTS = 'documents';

/** Full-text fields indexed with .ngram / .raw / .std / .words subfields. */
export const TEXT_FIELDS = [
  'instrumentNumber',
  'instrumentType',
  'legalDescription',
  'remarks',
  'address',
  'CADNumber',
  'CADNumber2',
  'GLOLink',
  'book',
  'volume',
  'page',
  'abstractText',
  'fieldNotes',
  'abstractCode',
  'subBlock',
  'marketShare',
  'countyName',
  'grantors',
  'grantees',
];

/** Same columns as MySQL MATCH(...) in [search.js](server/services/documents/search.js) criteria. */
export const CRITERIA_FIELDS = [
  'instrumentNumber',
  'instrumentType',
  'legalDescription',
  'remarks',
  'address',
  'CADNumber',
  'CADNumber2',
  'book',
  'volume',
  'page',
  'abstractText',
  'fieldNotes',
];

/** Criteria multi_match targets ngram + std + words (same subfields as python/opensearch_index_documents.py). */
export function criteriaMultiMatchFields() {
  const fields = [];
  for (const f of CRITERIA_FIELDS) {
    fields.push(`${f}.ngram^1`, `${f}.std^1.5`, `${f}.words^1.2`);
  }
  return fields;
}
