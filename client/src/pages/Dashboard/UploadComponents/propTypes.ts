import type { DocMetaData } from "./types";

export type UploadModalProps = {
  open: boolean;
  onClose: () => void;
  onUploaded?: (payload: { documentID: number; ai_extraction?: any } | null) => void;
};

export type UploadFileListProps = {
  files: File[];
  documents: DocMetaData[];
  fileStatuses: Record<number, string>;
  busy: boolean;
  onRemove: (i: number) => void;
  toStatusClass: (s: string) => string;
};

export type UploadDropZoneProps = {
  inputRef: React.RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  onFiles: (files: File[]) => void;
};