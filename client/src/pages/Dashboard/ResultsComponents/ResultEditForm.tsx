import React from "react";
import type { EditValues } from "./resultsTypes";

type ResultEditFormProps = {
  editValues: EditValues;
  setEditValues: React.Dispatch<React.SetStateAction<EditValues>>;
};

export function ResultEditForm({ editValues, setEditValues }: ResultEditFormProps) {
  const update = (key: keyof EditValues, value: string | number) =>
    setEditValues((v) => ({ ...v, [key]: value }));

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
      <div className="doc-meta">
        <div className="kv">
          <b>Instrument #</b>
          <input
            className="input"
            value={editValues.instrumentNumber || ""}
            onChange={(e) => update("instrumentNumber", e.target.value)}
          />
        </div>

        <div className="kv wide">
          <b>Parties</b>
          <input
            className="input"
            placeholder="Grantor"
            value={editValues.grantor || ""}
            onChange={(e) => update("grantor", e.target.value)}
          />
          <input
            className="input"
            placeholder="Grantee"
            value={editValues.grantee || ""}
            onChange={(e) => update("grantee", e.target.value)}
          />
        </div>

        <div className="kv">
          <b>Type</b>
          <input
            className="input"
            value={editValues.instrumentType || ""}
            onChange={(e) => update("instrumentType", e.target.value)}
          />
        </div>

        <div className="kv">
          <b>Book</b>
          <input
            className="input"
            value={editValues.book || ""}
            onChange={(e) => update("book", e.target.value)}
          />
        </div>
        <div className="kv">
          <b>Volume</b>
          <input
            className="input"
            value={editValues.volume || ""}
            onChange={(e) => update("volume", e.target.value)}
          />
        </div>
        <div className="kv">
          <b>Page</b>
          <input
            className="input"
            value={editValues.page || ""}
            onChange={(e) => update("page", e.target.value)}
          />
        </div>

        <div className="kv">
          <b>Filed</b>
          <input
            className="input mono"
            placeholder="YYYY-MM-DD"
            value={editValues.filingDate || ""}
            onChange={(e) => update("filingDate", e.target.value)}
          />
        </div>

        <div className="kv">
          <b>File Stamp</b>
          <input
            className="input mono"
            placeholder="YYYY-MM-DD"
            value={editValues.fileStampDate || ""}
            onChange={(e) => update("fileStampDate", e.target.value)}
          />
        </div>

        <div className="kv">
          <b>ExportFlag</b>
          <input
            className="input"
            placeholder="0 or 1"
            value={editValues.exportFlag ?? 0}
            onChange={(e) =>
              update("exportFlag", Number(e.target.value) || 0)
            }
          />
        </div>
      </div>

      <div className="legal">
        <div className="legal-label">
          <b>Legal:</b>
        </div>
        <textarea
          className="textarea legal-content"
          style={{
            WebkitLineClamp: "unset",
            display: "block",
            maxHeight: 220,
            overflow: "auto",
          }}
          value={editValues.legalDescription || ""}
          onChange={(e) => update("legalDescription", e.target.value)}
        />
      </div>

      <div className="kv wide">
        <b>Remarks</b>
        <input
          className="input"
          value={editValues.remarks || ""}
          onChange={(e) => update("remarks", e.target.value)}
        />
      </div>

      <div className="kv wide">
        <b>Address</b>
        <input
          className="input"
          value={editValues.address || ""}
          onChange={(e) => update("address", e.target.value)}
        />
      </div>
    </div>
  );
}
