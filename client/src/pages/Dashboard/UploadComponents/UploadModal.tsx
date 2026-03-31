import "./UploadModal.css";
import React, { useState } from "react";
import { UploadDropZone } from "./UploadDropZone";
import { UploadFileList } from "./UploadFileList";
import { UploadModeSelector } from "./UploadModeSelector";
import { UploadModalProgressBars } from "./UploadModalProgressBars";
import type { UploadModalProps } from "./propTypes";
import type { County, DocMetaData, UploadInfo, UploadMode, RegularDocumentScanProgress } from "./types";
import { getBookPipelineStatusLabel, toStatusClass, uploadFileWithProgress, isTif } from "./uploadModalUtils";

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
  const [fileProgress, setFileProgress] = useState<Record<number, RegularDocumentScanProgress>>({});
  const [uploadMode, setUploadMode] = useState<UploadMode>("regular");

  const [tifPagesProcessed, setTifPagesProcessed] = useState<number | null>(null);
  const [tifPagesTotal, setTifPagesTotal] = useState<number | null>(null);
  const [documentsQueued, setDocumentsQueued] = useState<number | null>(null);
  const [documentsTotal, setDocumentsTotal] = useState<number | null>(null);
  const [documentsAiProcessed, setDocumentsAiProcessed] = useState<number | null>(null);
  const [documentsAiFailed, setDocumentsAiFailed] = useState<number | null>(null);
  const [documentsDbUpdated, setDocumentsDbUpdated] = useState<number | null>(null);
  const [documentsDbFailed, setDocumentsDbFailed] = useState<number | null>(null);

  const [batchId, setBatchId] = useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const filePickerAccept = uploadMode === "book"
    ? ".tif,.tiff,image/tiff"
    : ".pdf,.tif,.tiff,application/pdf,image/*";
  const pollingActiveRef = React.useRef(false);
  const pollingTimeoutRef = React.useRef<number | null>(null);

  const stopPolling = React.useCallback(() => {
    pollingActiveRef.current = false;
    if (pollingTimeoutRef.current !== null) {
      window.clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  }, []);

  const schedulePoll = React.useCallback((fn: () => void | Promise<void>, delayMs: number) => {
    if (!pollingActiveRef.current) return;
    pollingTimeoutRef.current = window.setTimeout(() => {
      pollingTimeoutRef.current = null;
      if (!pollingActiveRef.current) return;
      void fn();
    }, delayMs);
  }, []);

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
      stopPolling();
      setFiles([]);
      setErr(null);
      setBusy(false);
      setSelectedCounty("");
      setSelectedCountyID(null);
      setFileStatuses({});
      setFileStages({});
      setFileProgress({});
      setDocuments([]);
      setTifPagesProcessed(null);
      setTifPagesTotal(null);
      setDocumentsQueued(null);
      setDocumentsTotal(null);
      setDocumentsAiProcessed(null);
      setDocumentsAiFailed(null);
      setDocumentsDbUpdated(null);
      setDocumentsDbFailed(null);
      setBatchId(null);
    }
  }, [open, stopPolling]);

  React.useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  if (!open) return null;

  const updateFileStatus = (key: string | number, status: string) => {
    setFileStatuses(prev => ({ ...prev, [key]: status }));
  };

  const updateFileStage = (key: string | number, stage: number) => {
    setFileStages(prev => ({ ...prev, [key]: stage }));
  };

  const removeAt = (i: number) => {
    setFiles(prev => prev.filter((_, idx) => idx !== i));
  };

  const upload = async () => {
    stopPolling();
    setBusy(true);
    setErr(null);
    setFileStatuses({});
    setFileProgress({});

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
    const BATCH_SIZE = 100;

    const { docs, renamedFiles, allUploads } = await createDocumentsAndFetchPresignedUrls(BATCH_SIZE);

    await uploadFilesToS3(renamedFiles, allUploads, docs);

    docs.forEach((d: DocMetaData) => {
      updateFileStatus(d.documentID, "Queueing for AI processing");
      updateFileStage(d.documentID, 3);
    });

    let batchIdForPolling: string | null = null;
    try {
      batchIdForPolling = await createBatchAndQueueForAi(docs, allUploads, BATCH_SIZE);
    } catch (error) {
      docs.forEach((d: DocMetaData) => {
        updateFileStatus(d.documentID, "Failed: Queueing documents failed");
        updateFileStage(d.documentID, 5);
      });
      throw error;
    }

    docs.forEach((d: DocMetaData) => {
      updateFileStatus(d.documentID, "Document Queued");
      updateFileStage(d.documentID, 4);
    });

    startRegularCompletionPolling(batchIdForPolling, docs);
  }

  async function createDocumentsAndFetchPresignedUrls(BATCH_SIZE: number) {
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
    return { docs, renamedFiles, allUploads };
  }

  async function uploadFilesToS3(
    renamedFiles: File[],
    allUploads: UploadInfo[],
    docs: DocMetaData[]
  ) {
    for (const file of renamedFiles) {
      const doc = docs.find((d: DocMetaData) => d.newFileName === file.name)!;
      updateFileStatus(doc.documentID, "Uploading to S3");
      updateFileStage(doc.documentID, 1);
      const putUrl = allUploads.find((u: UploadInfo) => u.documentID === doc.documentID)!.url;
      await uploadFileWithProgress(putUrl, file, () => {});
      updateFileStatus(doc.documentID, "Uploaded");
      updateFileStage(doc.documentID, 2);
    }
  }

  async function createBatchAndQueueForAi(
    docs: DocMetaData[],
    allUploads: UploadInfo[],
    BATCH_SIZE: number
  ): Promise<string | null> {
    let batchIdForPolling: string | null = null;
    const createBatchRes = await fetch(`${API_BASE}/documents/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total: docs.length }),
    });
    if (createBatchRes.ok) {
      const { batchId: id } = await createBatchRes.json();
      batchIdForPolling = id ?? null;
      setBatchId(id ?? null);
      setDocumentsTotal(docs.length);
      setDocumentsAiProcessed(0);
      setDocumentsAiFailed(0);
      setDocumentsDbUpdated(0);
      setDocumentsDbFailed(0);
    }

    for (let i = 0; i < allUploads.length; i += BATCH_SIZE) {
      const batch = allUploads.slice(i, i + BATCH_SIZE);
      const body: { uploads: unknown[]; batchId?: string } = {
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
      if (batchIdForPolling) body.batchId = batchIdForPolling;
      const res = await fetch(`${API_BASE}/documents/queue-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Queue batch failed at batch starting with index ${i}`);
      }
    }
    return batchIdForPolling;
  }

  function startRegularCompletionPolling(
    batchIdForPolling: string | null,
    docs: DocMetaData[]
  ) {
    const docIds = docs.map((d: DocMetaData) => d.documentID);
    const maxPollAttempts = 120;
    const pollIntervalMs = 5000;
    let pollAttempts = 0;
    stopPolling();
    pollingActiveRef.current = true;

    if (batchIdForPolling) {
      const pollBatchStatus = async (): Promise<void> => {
        if (!pollingActiveRef.current) return;
        if (pollAttempts >= maxPollAttempts) {
          stopPolling();
          return;
        }
        pollAttempts++;
        try {
          const statusRes = await fetch(`${API_BASE}/documents/batch/${batchIdForPolling}/status`);
          if (!statusRes.ok) {
            schedulePoll(pollBatchStatus, pollIntervalMs);
            return;
          }
          const data = await statusRes.json();
          const total = data.documentsTotal ?? docs.length;
          const aiProcessed = data.documentsAiProcessed ?? 0;
          const aiFailed = data.documentsAiFailed ?? 0;
          const dbUpdated = data.documentsDbUpdated ?? 0;
          const dbFailed = data.documentsDbFailed ?? 0;
          const failed = aiFailed + dbFailed > 0;
          const progressMap: Record<number, RegularDocumentScanProgress> = {};
          for (const docProgress of data.documents || []) {
            progressMap[docProgress.documentID] = {
              scanStatus: docProgress.scanStatus ?? "pending",
              scanPagesProcessed: docProgress.scanPagesProcessed ?? 0,
              scanPagesTotal: docProgress.scanPagesTotal ?? null,
              scanError: docProgress.scanError ?? null,
            };
          }
          setFileProgress(progressMap);
          docs.forEach((d: DocMetaData) => {
            const progress = progressMap[d.documentID];
            if (!progress) return;

            if (progress.scanStatus === "failed") {
              updateFileStatus(d.documentID, `Failed: ${progress.scanError || "Processing failed"}`);
              updateFileStage(d.documentID, 5);
              return;
            }

            if (progress.scanStatus === "db_done") {
              updateFileStatus(d.documentID, "Saved");
              updateFileStage(d.documentID, 5);
              return;
            }

            if (progress.scanStatus === "ai_done") {
              updateFileStatus(d.documentID, "AI complete, saving...");
              updateFileStage(d.documentID, 4);
              return;
            }

            if (progress.scanStatus === "processing") {
              if (progress.scanPagesTotal && progress.scanPagesTotal > 0) {
                updateFileStatus(
                  d.documentID,
                  `Processing pages ${progress.scanPagesProcessed}/${progress.scanPagesTotal}`
                );
              } else {
                updateFileStatus(d.documentID, "Processing pages...");
              }
              updateFileStage(d.documentID, 4);
              return;
            }

            updateFileStatus(d.documentID, "Queued for processing");
            updateFileStage(d.documentID, 4);
          });
          setDocumentsTotal(total);
          setDocumentsAiProcessed(aiProcessed);
          setDocumentsAiFailed(aiFailed);
          setDocumentsDbUpdated(dbUpdated);
          setDocumentsDbFailed(dbFailed);
          if (failed || data.status === "failed") {
            const errorMsg = data.error || `Processing failed (${aiFailed} AI failed, ${dbFailed} DB failed).`;
            docs.forEach((d: DocMetaData) => {
              updateFileStatus(d.documentID, `Failed: ${errorMsg}`);
              updateFileStage(d.documentID, 5);
            });
            setErr(errorMsg);
            stopPolling();
            return;
          }
          if (dbUpdated >= total && aiFailed === 0 && dbFailed === 0) {
            docs.forEach((d: DocMetaData) => {
              updateFileStatus(d.documentID, "Saved");
              updateFileStage(d.documentID, 5);
            });
            onUploaded?.({ documentID: docs[0].documentID });
            stopPolling();
            return;
          }
          schedulePoll(pollBatchStatus, pollIntervalMs);
        } catch {
          schedulePoll(pollBatchStatus, pollIntervalMs);
        }
      };
      schedulePoll(pollBatchStatus, pollIntervalMs);
    } else {
      onUploaded?.({ documentID: docs[0].documentID });
      const pollStatus = async (): Promise<void> => {
        if (!pollingActiveRef.current) return;
        if (pollAttempts >= maxPollAttempts) {
          stopPolling();
          return;
        }
        pollAttempts++;
        try {
          const statusRes = await fetch(`${API_BASE}/documents/status?ids=${docIds.join(",")}`);
          if (!statusRes.ok) {
            schedulePoll(pollStatus, pollIntervalMs);
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
          if (!allExtracted) {
            schedulePoll(pollStatus, pollIntervalMs);
            return;
          }
          stopPolling();
        } catch {
          schedulePoll(pollStatus, pollIntervalMs);
        }
      };
      schedulePoll(pollStatus, pollIntervalMs);
    }
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

      await uploadFileWithProgress(url, file, () => {});

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

    // If we get 202, the job was created in the DB and queued - poll until it completes or fails
    if (processRes.status === 202) {
      const pollInterval = 3000; // 3 seconds
      stopPolling();
      pollingActiveRef.current = true;

      await new Promise<void>((resolve, reject) => {
        const pollStatus = async (): Promise<void> => {
          if (!pollingActiveRef.current) return;
          try {
            const statusRes = await fetch(`${API_BASE}/tif-books/${bookId}/process-status`);

            if (!statusRes.ok) {
              if (statusRes.status === 404) {
                const errorMsg = "Job not found";
                files.forEach(f => updateFileStatus(f.name, `Failed: ${errorMsg}`));
                stopPolling();
                reject(new Error(errorMsg));
                return;
              }
              schedulePoll(pollStatus, pollInterval);
              return;
            }

            const statusData = await statusRes.json();
            const status = statusData.status;

            if (statusData.pagesTotal != null) setTifPagesTotal(statusData.pagesTotal);
            if (statusData.pagesProcessed != null) setTifPagesProcessed(statusData.pagesProcessed);
            if (statusData.documentsQueuedForAi != null) setDocumentsQueued(statusData.documentsQueuedForAi);
            if (statusData.documentsTotal != null) setDocumentsTotal(statusData.documentsTotal);
            if (statusData.documentsAiProcessed != null) setDocumentsAiProcessed(statusData.documentsAiProcessed);
            if (statusData.documentsAiFailed != null) setDocumentsAiFailed(statusData.documentsAiFailed);
            if (statusData.documentsDbUpdated != null) setDocumentsDbUpdated(statusData.documentsDbUpdated);
            if (statusData.documentsDbFailed != null) setDocumentsDbFailed(statusData.documentsDbFailed);

            const aiFailed = statusData.documentsAiFailed ?? 0;
            const dbFailed = statusData.documentsDbFailed ?? 0;
            if (aiFailed > 0 || dbFailed > 0) {
              const errorMsg = statusData.error || `Processing failed (${aiFailed} AI failed, ${dbFailed} DB failed).`;
              files.forEach(f => updateFileStatus(f.name, `Failed: ${errorMsg}`));
              stopPolling();
              reject(new Error(errorMsg));
              return;
            }

            if (status === "completed") {
              const total = statusData.documentsTotal ?? null;
              const dbUpdated = statusData.documentsDbUpdated ?? 0;
              const allDbDone = total != null && dbUpdated >= total;
              if (allDbDone) {
                const documentsCreated = statusData.documentsCreated ?? 0;
                files.forEach(f => updateFileStatus(f.name, "Complete"));
                onUploaded?.({ documentID: 0, ai_extraction: { documentsCreated } });
                stopPolling();
                resolve();
                return;
              }
              const label = getBookPipelineStatusLabel(statusData);
              files.forEach(f => updateFileStatus(f.name, label));
              schedulePoll(pollStatus, pollInterval);
              return;
            }

            if (status === "failed") {
              const errorMsg = statusData.error || "Book process failed";
              files.forEach(f => updateFileStatus(f.name, `Failed: ${errorMsg}`));
              stopPolling();
              reject(new Error(errorMsg));
              return;
            }

            // Still processing or pending
            if (status === "processing" || status === "pending") {
              const label = getBookPipelineStatusLabel(statusData);
              files.forEach(f => updateFileStatus(f.name, label));
              schedulePoll(pollStatus, pollInterval);
              return;
            }

            const errorMsg = `Unknown job status: ${status}`;
            files.forEach(f => updateFileStatus(f.name, `Failed: ${errorMsg}`));
            stopPolling();
            reject(new Error(errorMsg));
          } catch {
            // Retry on transient errors (e.g. network)
            schedulePoll(pollStatus, pollInterval);
          }
        };

        schedulePoll(pollStatus, pollInterval);
      });
    } else {
      // Legacy response format (shouldn't happen with new implementation)
      const { documentsCreated } = await processRes.json();
      files.forEach(f => updateFileStatus(f.name, "Complete"));
      onUploaded?.({ documentID: 0, ai_extraction: { documentsCreated } });
    }
  }

  const bookModeNonTifCount = uploadMode === "book" ? files.filter(f => !isTif(f.name)).length : 0;
  const bookModeWarning = uploadMode === "book" && bookModeNonTifCount > 0;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal modal-wide">
        <h3>Upload Documents</h3>

        <UploadModeSelector uploadMode={uploadMode} onModeChange={setUploadMode} />

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
          accept={filePickerAccept}
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
        <UploadModalProgressBars
          uploadMode={uploadMode}
          batchId={batchId}
          documentsTotal={documentsTotal}
          documentsQueued={documentsQueued}
          documentsAiProcessed={documentsAiProcessed}
          documentsAiFailed={documentsAiFailed}
          documentsDbUpdated={documentsDbUpdated}
          documentsDbFailed={documentsDbFailed}
          tifPagesTotal={tifPagesTotal}
          tifPagesProcessed={tifPagesProcessed}
        />
        {files.length > 0 && (
          <UploadFileList
            files={files}
            documents={documents}
            fileStatuses={fileStatuses}
            fileStages={fileStages}
            fileProgress={fileProgress}
            busy={busy}
            onRemove={removeAt}
            toStatusClass={toStatusClass}
            uploadMode={uploadMode}
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