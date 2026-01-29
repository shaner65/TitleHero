type DocMetaData = {
  documentID: number;
  originalName: string;
  newFileName: string;
};

type Props = {
  files: File[];
  documents: DocMetaData[];
  fileStatuses: Record<number, string>;
  busy: boolean;
  onRemove: (i: number) => void;
  toStatusClass: (s: string) => string;
};

export function UploadFileList({
  files,
  documents,
  fileStatuses,
  busy,
  onRemove,
  toStatusClass
}: Props) {
  return (
    <div className="file-list">
      {files.map((f, i) => {
        const doc = documents.find(d => d.originalName === f.name);
        const status = doc ? fileStatuses[doc.documentID] : "Waiting";
        const displayName = doc?.newFileName ?? f.name;
        const statusClass = toStatusClass(status);

        return (
          <div key={i} className="file-row">
            <div className="file-name">{displayName}</div>
            <div className="file-size">{(f.size / 1024).toFixed(1)} KB</div>
            <div className={`file-status ${statusClass}`}>{status}</div>
            <button disabled={busy} onClick={() => onRemove(i)}>×</button>
          </div>
        );
      })}
    </div>
  );
}