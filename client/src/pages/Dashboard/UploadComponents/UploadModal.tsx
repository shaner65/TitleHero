import "./UploadModal.css";
import React, { useState } from "react";
import { UploadDropZone } from "./UploadDropZone";
import { UploadFileList } from "./UploadFileList";
import type { UploadModalProps } from "./propTypes";
import type { County, DocMetaData, UploadInfo, UploadMode } from "./types";

const API_BASE = import.meta.env.DEV ? "/api" : import.meta.env.VITE_API_TARGET || "https://5mj0m92f17.execute-api.us-east-2.amazonaws.com/api";

export function UploadModal({ open, onClose, onUploaded }: UploadModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [counties, setCounties] = useState<County[]>([]);
  const [selectedCounty, setSelectedCounty] = useState("");
  const [selectedCountyID, setSelectedCountyID] = useState<number | null>(null);

  const [documents, setDocuments] = useState<DocMetaData[]>([]);
  const [fileStatuses, setFileStatuses] = useState<Record<string | number, string>>({});
  const [fileStages, setFileStages] = useState<Record<string | number, number>>({});
  const [fileUploadPercent, setFileUploadPercent] = useState<Record<string | number, number>>({});
  const [uploadMode, setUploadMode] = useState<UploadMode>("regular");

  const [tifPagesProcessed, setTifPagesProcessed] = useState<number | null>(null);
  const [tifPagesTotal, setTifPagesTotal] = useState<number | null>(null);
  const [documentsQueued, setDocumentsQueued] = useState<number | null>(null);
  const [documentsTotal, setDocumentsTotal] = useState<number | null>(null);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const PIPELINE_STAGES = 6;

  function handleFiles(newFiles: File[]) {
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...newFiles.filter(f => !existing.has(f.name + f.size))];
    });
  }

  React.useEffect(() => {
    fetch(`${API_BASE}/county`)
      .then(res => res.json())
      .then(data => setCounties(data));
  }, []);

  React.useEffect(() => {
    if (!open) {
      setFiles([]);
      setErr(null);
      setBusy(false);
      setSelectedCounty("");
      setSelectedCountyID(null);
      setFileStatuses({});
      setFileStages({});
      setFileUploadPercent({});
      setDocuments([]);
      setTifPagesProcessed(null);
      setTifPagesTotal(null);
      setDocumentsQueued(null);
      setDocumentsTotal(null);
    }
  }, [open]);

  if (!open) return null;

  const updateFileStatus = (key: string | number, status: string) => {
    setFileStatuses(prev => ({ ...prev, [key]: status }));
  };

  const updateFileStage = (key: string | number, stage: number) => {
    setFileStages(prev => ({ ...prev, [key]: stage }));
  };

  const updateFileUploadPercent = (key: string | number, percent: number) => {
    setFileUploadPercent(prev => ({ ...prev, [key]: percent }));
  };

  const removeAt = (i: number) => {
    setFiles(prev => prev.filter((_, idx) => idx !== i));
  };

  const toStatusClass = (status: string) =>
    status.toLowerCase().replace(/[^\w]+/g, "-");

  function uploadFileWithProgress(
    url: string,
    file: File,
    onProgress: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed: ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(file);
    });
  }

  const upload = async () => {
    setBusy(true);
    setErr(null);
    setFileStatuses({});

    try {
      if (uploadMode === "regular") {
        await uploadRegular();
      } else {
        await uploadBook();
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Upload failed");
      onUploaded?.(null);
    } finally {
      setBusy(false);
    }
  };

  async function uploadRegular() {
    const createRes = await fetch(`${API_BASE}/documents/create-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: files.map(f => ({ name: f.name, size: f.size, type: f.type })),
      }),
    });

    const { documents: docs } = await createRes.json();
    setDocuments(docs);

    const docByName = new Map<string, DocMetaData>(
      docs.map((d: DocMetaData) => [d.originalName, d])
    );

    const renamedFiles = files.map(orig => {
      const doc = docByName.get(orig.name)!;
      updateFileStatus(doc.documentID, "Document created");
      updateFileStage(doc.documentID, 0);
      return new File([orig], doc.newFileName, { type: orig.type });
    });

    const BATCH_SIZE = 100;
    const allUploads: UploadInfo[] = [];

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);

      const presignRes = await fetch(`${API_BASE}/documents/presign-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countyName: selectedCounty,
          documents: batch.map((d: DocMetaData) => ({
            documentID: d.documentID,
            newFileName: d.newFileName,
            type: d.type,
          })),
        }),
      });

      if (!presignRes.ok) throw new Error("Presign batch failed");

      const { uploads } = await presignRes.json();
      allUploads.push(...uploads);
    }

    for (const file of renamedFiles) {
      const doc = docs.find((d: DocMetaData) => d.newFileName === file.name)!;
      updateFileStatus(doc.documentID, "Uploading to S3");
      updateFileStage(doc.documentID, 1);
      updateFileUploadPercent(doc.documentID, 0);

      const putUrl = allUploads.find((u: UploadInfo) => u.documentID === doc.documentID)!.url;
      await uploadFileWithProgress(putUrl, file, (percent) => {
        updateFileUploadPercent(doc.documentID, percent);
      });

      updateFileUploadPercent(doc.documentID, 100);
      updateFileStatus(doc.documentID, "Uploaded");
      updateFileStage(doc.documentID, 2);
    }

    docs.forEach((d: DocMetaData) => {
      updateFileStatus(d.documentID, "Queueing for AI processing");
      updateFileStage(d.documentID, 3);
    });

    for (let i = 0; i < allUploads.length; i += BATCH_SIZE) {
      const batch = allUploads.slice(i, i + BATCH_SIZE);

      const body = {
        uploads: batch.map((u: UploadInfo) => {
          const d = docs.find((x: DocMetaData) => x.documentID === u.documentID)!;
          return {
            documentID: u.documentID,
            PRSERV: d.PRSERV,
            countyID: selectedCountyID,
            countyName: selectedCounty,
            fileName: d.newFileName,
            type: d.type,
          };
        }),
      };

      const res = await fetch(`${API_BASE}/documents/queue-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Queue batch failed at batch starting with index ${i}`);
      }
    }

    docs.forEach((d: DocMetaData) => {
      updateFileStatus(d.documentID, "Document Queued");
      updateFileStage(d.documentID, 4);
    });
    onUploaded?.({ documentID: docs[0].documentID });

    const docIds = docs.map((d: DocMetaData) => d.documentID);
    const maxPollAttempts = 120;
    const pollIntervalMs = 5000;
    let pollAttempts = 0;

    const pollStatus = async (): Promise<void> => {
      if (pollAttempts >= maxPollAttempts) return;
      pollAttempts++;
      try {
        const statusRes = await fetch(`${API_BASE}/documents/status?ids=${docIds.join(",")}`);
        if (!statusRes.ok) {
          setTimeout(pollStatus, pollIntervalMs);
          return;
        }
        const { statuses } = await statusRes.json();
        let allExtracted = true;
        for (const s of statuses || []) {
          if (s.status === "extracted") {
            updateFileStatus(s.documentID, "Extracted");
            updateFileStage(s.documentID, 5);
          } else {
            allExtracted = false;
          }
        }
        if (!allExtracted) setTimeout(pollStatus, pollIntervalMs);
      } catch {
        setTimeout(pollStatus, pollIntervalMs);
      }
    };
    setTimeout(pollStatus, pollIntervalMs);
  }

  async function uploadBook() {
    const presignRes = await fetch(`${API_BASE}/tif-books/presign-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        countyName: selectedCounty,
        files: files.map(f => ({ name: f.name, size: f.size, type: f.type })),
      }),
    });

    if (!presignRes.ok) {
      const errData = await presignRes.json().catch(() => ({}));
      throw new Error(errData.error || "Presign batch failed");
    }

    const { bookId, uploads: presignedUploads } = await presignRes.json();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const { url } = presignedUploads[i];
      updateFileStatus(file.name, "Uploading to S3");
      updateFileUploadPercent(file.name, 0);

      await uploadFileWithProgress(url, file, (percent) => {
        updateFileUploadPercent(file.name, percent);
      });

      updateFileUploadPercent(file.name, 100);
      updateFileStatus(file.name, "Uploaded");
    }

    files.forEach(f => updateFileStatus(f.name, "Processing book…"));

    const processRes = await fetch(`${API_BASE}/tif-books/${bookId}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        countyID: selectedCountyID,
        countyName: selectedCounty,
      }),
    });

    if (!processRes.ok) {
      const errData = await processRes.json().catch(() => ({}));
      throw new Error(errData.error || "Book process failed");
    }

    // If we get 202, the job was created in the DB and queued - poll for status
    if (processRes.status === 202) {
      const maxPollAttempts = 200; // 200 * 3 seconds = 10 minutes max
      let pollAttempts = 0;
      const pollInterval = 3000; // 3 seconds

      // Show immediately that the job exists in the DB
      files.forEach(f => updateFileStatus(f.name, "Job created (pending)"));

      const pollStatus = async (): Promise<void> => {
        try {
          const statusRes = await fetch(`${API_BASE}/tif-books/${bookId}/process-status`);

          if (!statusRes.ok) {
            if (statusRes.status === 404) {
              throw new Error("Job not found");
            }
            throw new Error("Failed to get job status");
          }

          const statusData = await statusRes.json();
          const status = statusData.status;
          const documentsQueuedForAi = statusData.documentsQueuedForAi;

          if (statusData.pagesTotal != null) setTifPagesTotal(statusData.pagesTotal);
          if (statusData.pagesProcessed != null) setTifPagesProcessed(statusData.pagesProcessed);
          if (documentsQueuedForAi != null) setDocumentsQueued(documentsQueuedForAi);
          if (statusData.documentsTotal != null) setDocumentsTotal(statusData.documentsTotal);

          if (status === "completed") {
            const documentsCreated = statusData.documentsCreated ?? 0;
            files.forEach(f => updateFileStatus(f.name, `Complete: ${documentsCreated} documents created`));
            onUploaded?.({ documentID: 0, ai_extraction: { documentsCreated } });
            return;
          }

          if (status === "failed") {
            const errorMsg = statusData.error || "Book process failed";
            files.forEach(f => updateFileStatus(f.name, `Failed: ${errorMsg}`));
            throw new Error(errorMsg);
          }

          // Still processing or pending - show current state and continue polling
          if (status === "processing" || status === "pending") {
            let statusText: string;
            if (status === "pending") {
              statusText = "Job created — waiting to process";
            } else if (typeof documentsQueuedForAi === "number" && documentsQueuedForAi > 0) {
              statusText = `Processing… ${documentsQueuedForAi} document(s) sent to AI processor`;
            } else {
              statusText = "Processing…";
            }
            files.forEach(f => updateFileStatus(f.name, statusText));

            pollAttempts++;
            if (pollAttempts >= maxPollAttempts) {
              files.forEach(f => updateFileStatus(f.name, "Timeout: Processing took too long"));
              throw new Error("Processing timeout - job may still be running");
            }
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            return pollStatus();
          }

          // Unknown status
          throw new Error(`Unknown job status: ${status}`);
        } catch (err) {
          if (err instanceof Error && err.message.includes("timeout")) {
            throw err;
          }
          // Retry on transient errors
          pollAttempts++;
          if (pollAttempts >= maxPollAttempts) {
            files.forEach(f => updateFileStatus(f.name, "Error: Failed to get status"));
            throw new Error("Failed to get job status after multiple attempts");
          }
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          return pollStatus();
        }
      };

      await pollStatus();
    } else {
      // Legacy response format (shouldn't happen with new implementation)
      const { documentsCreated } = await processRes.json();
      files.forEach(f => updateFileStatus(f.name, `Complete: ${documentsCreated} documents created`));
      onUploaded?.({ documentID: 0, ai_extraction: { documentsCreated } });
    }
  }

  const isTif = (name: string) =>
    /\.(tif|tiff)$/i.test(name);

  const bookModeNonTifCount = uploadMode === "book" ? files.filter(f => !isTif(f.name)).length : 0;
  const bookModeWarning = uploadMode === "book" && bookModeNonTifCount > 0;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal modal-wide">
        <h3>Upload Documents</h3>

        <div className="upload-mode-selector">
          <label className="upload-mode-option">
            <input
              type="radio"
              name="uploadMode"
              value="regular"
              checked={uploadMode === "regular"}
              onChange={() => setUploadMode("regular")}
            />
            <div className="upload-mode-text">
              <span className="upload-mode-label">Individual documents</span>
              <span className="upload-mode-hint">One PDF or image per document. Each file becomes its own record.</span>
            </div>
          </label>
          <label className="upload-mode-option">
            <input
              type="radio"
              name="uploadMode"
              value="book"
              checked={uploadMode === "book"}
              onChange={() => setUploadMode("book")}
            />
            <div className="upload-mode-text">
              <span className="upload-mode-label">Book (TIF pages)</span>
              <span className="upload-mode-hint">Multiple TIF pages from one book. AI will split pages into separate documents.</span>
            </div>
          </label>
        </div>

        <select
          value={selectedCounty}
          onChange={e => {
            const name = e.target.value;
            setSelectedCounty(name);
            const c = counties.find(x => x.name === name);
            setSelectedCountyID(c?.countyID ?? null);
          }}
        >
          <option value="">-- Select County --</option>
          {counties.map(c => (
            <option key={c.countyID} value={c.name}>{c.name}</option>
          ))}
        </select>

        <UploadDropZone
          inputRef={inputRef}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          onFiles={handleFiles}
        />

        {uploadMode === "regular" && documents.length > 0 && (() => {
          const extractedCount = documents.filter((d: DocMetaData) => fileStages[d.documentID] === 5).length;
          if (extractedCount === 0) return null;
          return (
            <div className="upload-overall-progress" style={{ marginBottom: "6px", fontSize: "0.9rem", color: "#059669" }}>
              {extractedCount} of {documents.length} document{documents.length !== 1 ? "s" : ""} complete
            </div>
          );
        })()}
        {uploadMode === "book" && busy && (tifPagesTotal != null || documentsTotal != null || (documentsQueued != null && documentsQueued > 0)) && (
          <div className="upload-book-progress-bars">
            {tifPagesTotal != null && tifPagesTotal > 0 && (
              <div className="upload-book-progress-row">
                <span className="upload-book-progress-label">Reading TIF: {tifPagesProcessed ?? 0} of {tifPagesTotal} pages</span>
                <div className="progress-bar" role="progressbar" aria-valuenow={tifPagesProcessed ?? 0} aria-valuemin={0} aria-valuemax={tifPagesTotal}>
                  <div className="progress-fill" style={{ width: `${Math.min(100, ((tifPagesProcessed ?? 0) / tifPagesTotal) * 100)}%` }} />
                </div>
              </div>
            )}
            {(documentsTotal != null || (documentsQueued != null && documentsQueued > 0)) && (
              <div className="upload-book-progress-row">
                <span className="upload-book-progress-label">
                  Documents: {documentsQueued ?? 0}{documentsTotal != null ? ` of ${documentsTotal}` : " created"}
                </span>
                <div
                  className={`progress-bar ${documentsTotal == null ? "progress-bar-indeterminate" : ""}`}
                  role="progressbar"
                  aria-valuenow={documentsQueued ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={documentsTotal ?? 100}
                >
                  <div
                    className="progress-fill"
                    style={{
                      width: documentsTotal != null && documentsTotal > 0
                        ? `${Math.min(100, ((documentsQueued ?? 0) / documentsTotal) * 100)}%`
                        : undefined,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        {files.length > 0 && (
          <UploadFileList
            files={files}
            documents={documents}
            fileStatuses={fileStatuses}
            busy={busy}
            onRemove={removeAt}
            toStatusClass={toStatusClass}
            uploadMode={uploadMode}
            fileStages={fileStages}
            fileUploadPercent={fileUploadPercent}
            pipelineStages={PIPELINE_STAGES}
          />
        )}

        {bookModeWarning && (
          <div className="upload-mode-warning">
            {bookModeNonTifCount} file{bookModeNonTifCount !== 1 ? "s" : ""} not TIF. Book mode expects TIF pages; non-TIF files may fail.
          </div>
        )}

        {err && <div className="error">{err}</div>}

        {files.length > 0 && (
          <div className="upload-info" style={{ marginBottom: "8px", fontWeight: "500" }}>
            {files.length} file{files.length !== 1 ? "s" : ""} selected for upload
          </div>
        )}

        <div className="actions">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={upload} disabled={!files.length || !selectedCounty || busy}>
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}