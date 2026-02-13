export type County = { countyID: number; name: string };

export type UploadMode = "regular" | "book";

export type DocMetaData = {
  documentID: number;
  PRSERV: string;
  originalName: string;
  newFileName: string;
  type?: string;
};

export type UploadInfo = {
  documentID: number;
  key: string;
  url: string;
};

/** Response shape from GET tif-books/:bookId/process-status (for pipeline label). */
export type BookProcessStatusData = {
  status: string;
  pagesTotal?: number | null;
  pagesProcessed?: number | null;
  documentsTotal?: number | null;
  documentsQueuedForAi?: number | null;
  documentsAiProcessed?: number | null;
  documentsDbUpdated?: number | null;
};