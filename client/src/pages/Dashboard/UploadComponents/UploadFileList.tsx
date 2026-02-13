import type { UploadFileListProps } from "./propTypes";

export function UploadFileList({
  files,
  documents,
  fileStatuses,
  busy,
  onRemove,
  toStatusClass,
  uploadMode = "regular",
}: UploadFileListProps) {
  return (
    <div className="file-list">
      {files.map((f, i) => {
        const doc = documents.find(d => d.originalName === f.name);
        const statusKey = uploadMode === "book" ? f.name : (doc?.documentID ?? f.name);
        const status = fileStatuses[statusKey] ?? "Waiting";
        const displayName = doc?.newFileName ?? f.name;
        const statusClass = toStatusClass(status);

        return (
          <div key={i} className="file-row">
            <div className="file-name">{displayName}</div>
            <div className="file-size">{(f.size / 1024).toFixed(1)} KB</div>
            <div className="file-row-progress">
              <div className={`file-status ${statusClass}`}>{status}</div>
            </div>
            <button disabled={busy} onClick={() => onRemove(i)}>×</button>
          </div>
        );
      })}
    </div>
  );
}