import type { UploadMode } from "./types";

type UploadModalProgressBarsProps = {
  uploadMode: UploadMode;
  busy: boolean;
  batchId: string | null;
  documentsTotal: number | null;
  documentsQueued: number | null;
  documentsAiProcessed: number | null;
  documentsDbUpdated: number | null;
  tifPagesTotal: number | null;
  tifPagesProcessed: number | null;
};

function ProgressRow({
  label,
  current,
  total,
  indeterminate = false,
}: {
  label: string;
  current: number;
  total: number | null;
  indeterminate?: boolean;
}) {
  const width =
    total != null && total > 0 ? `${Math.min(100, (current / total) * 100)}%` : undefined;
  return (
    <div className="upload-book-progress-row">
      <span className="upload-book-progress-label">{label}</span>
      <div
        className={`progress-bar ${indeterminate ? "progress-bar-indeterminate" : ""}`}
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={total ?? 100}
      >
        <div className="progress-fill" style={{ width }} />
      </div>
    </div>
  );
}

export function UploadModalProgressBars({
  uploadMode,
  busy,
  batchId,
  documentsTotal,
  documentsQueued,
  documentsAiProcessed,
  documentsDbUpdated,
  tifPagesTotal,
  tifPagesProcessed,
}: UploadModalProgressBarsProps) {
  const aiProcessed = documentsAiProcessed ?? 0;
  const dbUpdated = documentsDbUpdated ?? 0;
  const queued = documentsQueued ?? 0;
  const tifPages = tifPagesProcessed ?? 0;

  const showBookBars =
    uploadMode === "book" &&
    busy &&
    (tifPagesTotal != null || documentsTotal != null || (documentsQueued != null && documentsQueued > 0));

  const showRegularBars =
    uploadMode === "regular" &&
    busy &&
    batchId != null &&
    documentsTotal != null &&
    documentsTotal > 0;

  if (!showBookBars && !showRegularBars) return null;

  return (
    <>
      {showBookBars && (
        <div className="upload-book-progress-bars">
          {tifPagesTotal != null && tifPagesTotal > 0 && (
            <ProgressRow
              label={`Reading TIF: ${tifPages} of ${tifPagesTotal} pages`}
              current={tifPages}
              total={tifPagesTotal}
            />
          )}
          {(documentsTotal != null || (documentsQueued != null && documentsQueued > 0)) && (
            <ProgressRow
              label={`Documents: ${queued}${documentsTotal != null ? ` of ${documentsTotal}` : " created"}`}
              current={queued}
              total={documentsTotal}
              indeterminate={documentsTotal == null}
            />
          )}
          {documentsTotal != null && documentsTotal > 0 && (
            <>
              <ProgressRow
                label={`AI processing: ${aiProcessed} of ${documentsTotal}`}
                current={aiProcessed}
                total={documentsTotal}
              />
              <ProgressRow
                label={`Saving to DB: ${dbUpdated} of ${documentsTotal}`}
                current={dbUpdated}
                total={documentsTotal}
              />
            </>
          )}
        </div>
      )}
      {showRegularBars && documentsTotal != null && documentsTotal > 0 && (
        <div className="upload-book-progress-bars">
          <ProgressRow
            label={`AI processing: ${aiProcessed} of ${documentsTotal}`}
            current={aiProcessed}
            total={documentsTotal}
          />
          <ProgressRow
            label={`Saving to DB: ${dbUpdated} of ${documentsTotal}`}
            current={dbUpdated}
            total={documentsTotal}
          />
        </div>
      )}
    </>
  );
}
