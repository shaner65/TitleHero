import { FIELD_DEFS } from "./constants";

type FieldDefId = typeof FIELD_DEFS[number]["id"];

export type DateSearchMode = "exact" | "range" | "after" | "before";

export type FieldId =
  | FieldDefId
  | "filingDateMode"
  | "filingDateFrom"
  | "filingDateTo"
  | "fileStampDateMode"
  | "fileStampDateFrom"
  | "fileStampDateTo";