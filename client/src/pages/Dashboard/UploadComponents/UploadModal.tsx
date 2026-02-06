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
  const [uploadMode, setUploadMode] = useState<UploadMode>("regular");

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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
      setDocuments([]);
    }
  }, [open]);

  if (!open) return null;

  const updateFileStatus = (key: string | number, status: string) => {
    setFileStatuses(prev => ({ ...prev, [key]: status }));
  };

  const removeAt = (i: number) => {
    setFiles(prev => prev.filter((_, idx) => idx !== i));
  };

  const toStatusClass = (status: string) =>
    status.toLowerCase().replace(/[^\w]+/g, "-");

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

      const url = allUploads.find((u: UploadInfo) => u.documentID === doc.documentID)!.url;
      const res = await fetch(url, { method: "PUT", body: file });
      if (!res.ok) throw new Error("Upload failed");

      updateFileStatus(doc.documentID, "Uploaded");
    }

    docs.forEach((d: DocMetaData) => updateFileStatus(d.documentID, "Queueing for AI processing"));

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

    docs.forEach((d: DocMetaData) => updateFileStatus(d.documentID, "Document Queued"));
    onUploaded?.({ documentID: docs[0].documentID });
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

      const res = await fetch(url, { method: "PUT", body: file });
      if (!res.ok) throw new Error(`Upload failed for ${file.name}`);

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

    const { documentsCreated } = await processRes.json();

    files.forEach(f => updateFileStatus(f.name, `Complete: ${documentsCreated} documents created`));
    onUploaded?.({ documentID: 0, ai_extraction: { documentsCreated } });
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

        {files.length > 0 && (
          <UploadFileList
            files={files}
            documents={documents}
            fileStatuses={fileStatuses}
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