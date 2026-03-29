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

export const CRITERIA_FIELDS = TEXT_FIELDS;

export const CRITERIA_FIELD_ALL = 'all';

export function criteriaFieldListForSubfield(subfield) {
  const boost =
    subfield === 'ngram' ? '^1' : subfield === 'std' ? '^1.5' : subfield === 'words' ? '^1.2' : '^1';
  return TEXT_FIELDS.map((f) => `${f}.${subfield}${boost}`);
}

export function singleFieldCriteriaMultiMatchFields(fieldName) {
  return [`${fieldName}.ngram^1`, `${fieldName}.std^1.5`, `${fieldName}.words^1.2`];
}

export function criteriaMultiMatchFields() {
  const fields = [];
  for (const f of TEXT_FIELDS) {
    fields.push(`${f}.ngram^1`, `${f}.std^1.5`, `${f}.words^1.2`);
  }
  return fields;
}
