import type { UploadFileListProps } from "./propTypes";

export function UploadFileList({
  files,
  documents,
  fileStatuses,
  fileStages,
  busy,
  onRemove,
  toStatusClass,
  uploadMode = "regular",
}: UploadFileListProps) {
  const REGULAR_MODE_MAX_STAGE = 5;

  const getRegularRowProgress = (status: string, stage: number | undefined): number => {
    if (/^failed:/i.test(status)) return 100;
    const safeStage = Math.max(0, Math.min(REGULAR_MODE_MAX_STAGE, stage ?? 0));
    return Math.round((safeStage / REGULAR_MODE_MAX_STAGE) * 100);
  };

  return (
    <div className="file-list">
      {files.map((f, i) => {
        const doc = documents.find(d => d.originalName === f.name);
        const statusKey = uploadMode === "book" ? f.name : (doc?.documentID ?? f.name);
        const status = fileStatuses[statusKey] ?? "Waiting";
        const statusClass = toStatusClass(status);
        const stage = doc ? fileStages[doc.documentID] : undefined;
        const progressPercent = getRegularRowProgress(status, stage);
        const isRegularWithDoc = uploadMode === "regular" && doc != null;

        return (
          <div key={i} className="file-row">
            <div className="file-name">{f.name}</div>
            <div className="file-size">{(f.size / 1024).toFixed(1)} KB</div>
            <div className="file-row-progress">
              {isRegularWithDoc && (
                <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
                  <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
              )}
              <div className={`file-status ${statusClass}`}>{status}</div>
            </div>
            <button disabled={busy} onClick={() => onRemove(i)}>×</button>
          </div>
        );
      })}
    </div>
  );
}