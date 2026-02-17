/** All searchable fields from DB (ids match DB keys exactly) */
export const FIELD_DEFS = [
  // IDs / references
  { id: "documentID", label: "DOCUMENT ID", placeholder: "e.g., 6", type: "input", span: 3 },
  { id: "abstractCode", label: "ABSTRACT CODE", placeholder: "e.g., 42", type: "input", span: 3 },
  // { id: "bookTypeID", label: "BOOK TYPE ID", placeholder: "e.g., 1", type: "input", span: 3 },
  // { id: "subdivisionID", label: "SUBDIVISION ID", placeholder: "e.g., 17", type: "input", span: 3 },
  { id: "countyName", label: "COUNTY NAME", placeholder: "Select County", type: "select", span: 3 },

  // Instrument / book meta
  { id: "instrumentNumber", label: "INSTRUMENT NUMBER", placeholder: "e.g., IN12345", type: "input", span: 4 },
  { id: "book", label: "BOOK", placeholder: "e.g., Book A", type: "input", span: 3 },
  { id: "volume", label: "VOLUME", placeholder: "e.g., Vol 1", type: "input", span: 3 },
  { id: "page", label: "PAGE", placeholder: "e.g., 12", type: "input", span: 3 },

  // Parties / instrument type
  { id: "grantor", label: "GRANTOR", placeholder: "e.g., John Doe", type: "input", span: 4 },
  { id: "grantee", label: "GRANTEE", placeholder: "e.g., Jane Smith", type: "input", span: 4 },
  { id: "instrumentType", label: "INSTRUMENT TYPE", placeholder: "e.g., Deed", type: "input", span: 4 },

  // Amounts / numbers
  { id: "lienAmount", label: "LIEN AMOUNT", placeholder: "e.g., 50000.75", type: "input", span: 3 },
  { id: "acres", label: "ACRES", placeholder: "e.g., 2.5000", type: "input", span: 3 },
  { id: "exportFlag", label: "EXPORT FLAG", placeholder: "0 or 1", type: "input", span: 3 },
  { id: "GFNNumber", label: "GF NUMBER", placeholder: "e.g., 123", type: "input", span: 3 },
  { id: "marketShare", label: "MARKET SHARE", placeholder: "e.g., 50%", type: "input", span: 3 },

  // Legal / description blocks
  { id: "legalDescription", label: "LEGAL DESCRIPTION", placeholder: "Lot 1, Block A...", type: "textarea", span: 8 },
  { id: "subBlock", label: "SUB BLOCK", placeholder: "e.g., Block A", type: "input", span: 3 },
  { id: "abstractText", label: "ABSTRACT TEXT", placeholder: "Abstract text...", type: "textarea", span: 8 },
  { id: "fieldNotes", label: "FIELD NOTES", placeholder: "Field notes...", type: "textarea", span: 8 },
  { id: "remarks", label: "REMARKS", placeholder: "Remarks...", type: "textarea", span: 8 },

  // Dates / finalized
  { id: "fileStampDate", label: "FILE STAMP DATE", placeholder: "YYYY-MM-DD or ISO", type: "input", span: 4 },
  { id: "filingDate", label: "FILING DATE", placeholder: "YYYY-MM-DD or ISO", type: "input", span: 4 },
  { id: "finalizedBy", label: "FINALIZED BY", placeholder: "e.g., Admin User", type: "input", span: 4 },

  // Other references
  { id: "nFileReference", label: "N FILE REFERENCE", placeholder: "e.g., NF123456", type: "input", span: 4 },
  { id: "propertyType", label: "PROPERTY TYPE", placeholder: "e.g., Residential", type: "input", span: 4 },
  { id: "sortArray", label: "SORT ARRAY", placeholder: "e.g., [1,2,3]", type: "input", span: 4 },

  // Location / CAD / links
  { id: "address", label: "ADDRESS", placeholder: "e.g., 123 Main Street", type: "input", span: 6 },
  { id: "CADNumber", label: "CAD NUMBER", placeholder: "e.g., CAD001", type: "input", span: 3 },
  // { id: "CADNumber2", label: "CAD NUMBER 2", placeholder: "e.g., CAD002", type: "input", span: 3 },
  { id: "GLOLink", label: "GLO LINK", placeholder: "http://...", type: "input", span: 6 },

  // Timestamps
  { id: "created_at", label: "CREATED AT", placeholder: "ISO timestamp", type: "input", span: 4 },
  { id: "updated_at", label: "UPDATED AT", placeholder: "ISO timestamp", type: "input", span: 4 },

  // Optional freeform criteria (kept from your original UI)
  { id: "criteria", label: "SEARCH ALL FIELDS", placeholder: "", type: "textarea", span: 6 },
] as const;

/** Common fields shown by default */
export const COMMON_FIELD_IDS: (typeof FIELD_DEFS)[number]["id"][] = [
  "countyName",
  "grantor",
  "grantee",
  "volume",
  "page",
  "legalDescription",
];

/** Advanced fields shown in collapsible section */
export const ADVANCED_FIELD_IDS: (typeof FIELD_DEFS)[number]["id"][] = FIELD_DEFS.map(f => f.id).filter(
  id => !COMMON_FIELD_IDS.includes(id)
) as any[];

export const getFieldDef = (id: string) => FIELD_DEFS.find(f => f.id === id);