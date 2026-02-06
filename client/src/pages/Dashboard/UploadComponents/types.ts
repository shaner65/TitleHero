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