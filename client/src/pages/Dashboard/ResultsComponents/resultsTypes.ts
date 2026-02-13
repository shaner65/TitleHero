import type React from "react";

export type ResultsProp = {
  counties: {
    countyID: number;
    name: string;
  }[];
  setPdfLoading: React.Dispatch<React.SetStateAction<boolean>>;
  results: ResultRow[];
  setResults: React.Dispatch<React.SetStateAction<ResultRow[]>>;
  loading: boolean;
  error: string | null;
  offset: number;
  hasMore: boolean;
  submit: (newOffset?: number) => Promise<void>;
  searchTerms?: Record<string, string>;
};

export type ResultRow = {
  documentID: number;
  instrumentNumber?: string | null;
  grantor?: string | null;
  grantee?: string | null;
  grantors?: string | null;
  grantees?: string | null;
  instrumentType?: string | null;
  propertyType?: string | null;
  book?: string | null;
  volume?: string | null;
  page?: string | null;
  legalDescription?: string | null;
  remarks?: string | null;
  address?: string | null;
  filingDate?: string | null;
  fileStampDate?: string | null;
  exportFlag?: number | null;
  countyName?: string | null;
  PRSERV?: string | null;
  [key: string]: unknown;
};

export type EditValues = {
  instrumentNumber: string;
  grantor: string;
  grantee: string;
  instrumentType: string;
  book: string;
  volume: string;
  page: string;
  legalDescription: string;
  remarks: string;
  address: string;
  filingDate: string;
  fileStampDate: string;
  exportFlag: number;
};

export const EMPTY_EDIT_VALUES: EditValues = {
  instrumentNumber: "",
  grantor: "",
  grantee: "",
  instrumentType: "",
  book: "",
  volume: "",
  page: "",
  legalDescription: "",
  remarks: "",
  address: "",
  filingDate: "",
  fileStampDate: "",
  exportFlag: 0,
};
