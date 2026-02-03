import "./UploadModal.css";
import React, { useState } from "react";
import { UploadDropZone } from "./UploadDropZone";
import { UploadFileList } from "./UploadFileList";
import type { UploadModalProps } from "./propTypes";
import type { County, DocMetaData, UploadInfo } from "./types";

const API_BASE = import.meta.env.DEV ? "/api" : import.meta.env.VITE_API_TARGET || "https://5mj0m92f17.execute-api.us-east-2.amazonaws.com/api";

export function UploadModal({ open, onClose, onUploaded }: UploadModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [counties, setCounties] = useState<County[]>([]);
  const [selectedCounty, setSelectedCounty] = useState("");
  const [selectedCountyID, setSelectedCountyID] = useState<number | null>(null);

  const [documents, setDocuments] = useState<DocMetaData[]>([]);
  const [fileStatuses, setFileStatuses] = useState<Record<number, string>>({});

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

  const updateFileStatus = (documentID: number, status: string) => {
    setFileStatuses(prev => ({ ...prev, [documentID]: status }));
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

    // TODO figure out how to take in documents with multiple files

    try {
      const createRes = await fetch(`${API_BASE}/documents/create-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.map(f => ({ name: f.name, size: f.size, type: f.type })),
        }),
      });

      const { documents } = await createRes.json();
      setDocuments(documents);

      const docByName = new Map<string, DocMetaData>(
        documents.map((d: DocMetaData) => [d.originalName, d])
      );

      const renamedFiles = files.map(orig => {
        const doc = docByName.get(orig.name)!;
        updateFileStatus(doc.documentID, "Document created");
        return new File([orig], doc.newFileName, { type: orig.type });
      });

      const BATCH_SIZE = 100;
      const allUploads = [];

      for (let i = 0; i < documents.length; i += BATCH_SIZE) {
        const batch = documents.slice(i, i + BATCH_SIZE);

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

      const uploads = allUploads;

      for (const file of renamedFiles) {
        const doc = documents.find((d: DocMetaData) => d.newFileName === file.name)!;
        updateFileStatus(doc.documentID, "Uploading to S3");

        const url = uploads.find((u: UploadInfo) => u.documentID === doc.documentID)!.url;
        const res = await fetch(url, { method: "PUT", body: file });
        if (!res.ok) throw new Error("Upload failed");

        updateFileStatus(doc.documentID, "Uploaded");
      }

      documents.forEach((d: DocMetaData) => updateFileStatus(d.documentID, "Queueing for AI processing"));

      const allQueueResults = [];

      for (let i = 0; i < uploads.length; i += BATCH_SIZE) {
        const batch = uploads.slice(i, i + BATCH_SIZE);

        const body = {
          uploads: batch.map((u: UploadInfo) => {
            const d = documents.find((x: DocMetaData) => x.documentID === u.documentID)!;
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

        const result = await res.json();
        allQueueResults.push(result);
      }

      documents.forEach((d: DocMetaData) => updateFileStatus(d.documentID, "Document Queued"));
      onUploaded?.({ documentID: documents[0].documentID });

      // TODO: poll document status

    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Upload failed");
      onUploaded?.(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal modal-wide">
        <h3>Upload Documents</h3>

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
          />
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