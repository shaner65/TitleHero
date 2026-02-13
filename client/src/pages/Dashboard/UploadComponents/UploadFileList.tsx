import type { UploadFileListProps } from "./propTypes";

export function UploadFileList({
  files,
  documents,
  fileStatuses,
  busy,
  onRemove,
  toStatusClass,
  uploadMode = "regular",
  fileStages = {},
  fileUploadPercent = {},
  pipelineStages = 6,
}: UploadFileListProps) {
  return (
    <div className="file-list">
      {files.map((f, i) => {
        const doc = documents.find(d => d.originalName === f.name);
        const statusKey = uploadMode === "book" ? f.name : (doc?.documentID ?? f.name);
        const status = fileStatuses[statusKey] ?? "Waiting";
        const displayName = doc?.newFileName ?? f.name;
        const statusClass = toStatusClass(status);
        const stage = fileStages[statusKey] ?? 0;
        const uploadPct = fileUploadPercent[statusKey];
        const isUploading = status.toLowerCase().includes("uploading to s3") && typeof uploadPct === "number";
        const progressPercent = isUploading
          ? Math.min(100, uploadPct)
          : pipelineStages > 0
            ? Math.round((stage / (pipelineStages - 1)) * 100)
            : 0;

        return (
          <div key={i} className="file-row">
            <div className="file-name">{displayName}</div>
            <div className="file-size">{(f.size / 1024).toFixed(1)} KB</div>
            <div className="file-row-progress">
              <div className="progress-bar" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className={`file-status ${statusClass}`}>{status}</div>
            </div>
            <button disabled={busy} onClick={() => onRemove(i)}>×</button>
          </div>
        );
      })}
    </div>
  );
}