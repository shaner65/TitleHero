import React from "react";
import { highlightText, toDate, getTypeColor } from "./resultsUtils";
import type { ResultRow as ResultRowType, EditValues } from "./resultsTypes";
import { ResultEditForm } from "./ResultEditForm";
import { API_BASE } from "../../../constants/constants";

type ResultRowProps = {
  row: ResultRowType;
  searchTerms?: Record<string, string>;
  isRemoved: boolean;
  onRemove: (id: number) => void;
  onUndoRemove: (id: number) => void;
  hoverRemoveId: number | null;
  setHoverRemoveId: (id: number | null) => void;
  isEditing: boolean;
  editValues: EditValues;
  setEditValues: React.Dispatch<React.SetStateAction<EditValues>>;
  onBeginEdit: (row: ResultRowType) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number) => void;
  onDeleteRow: (id: number) => void;
  summaryText: string | undefined;
  summaryLoading: boolean;
  summaryError: string | undefined;
  isSummaryOpen: boolean;
  onToggleSummary: (id: number) => void;
  onPreviewPdf: (prefix?: string | null, countyName?: string | null) => void;
  onDownloadPdf: (prefix?: string | null, countyName?: string | null) => void;
};

export function ResultRow({
  row,
  searchTerms,
  isRemoved,
  onRemove,
  onUndoRemove,
  hoverRemoveId,
  setHoverRemoveId,
  isEditing,
  editValues,
  setEditValues,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onDeleteRow,
  summaryText,
  summaryLoading,
  summaryError,
  isSummaryOpen,
  onToggleSummary,
  onPreviewPdf,
  onDownloadPdf,
}: ResultRowProps) {
  const isHovering = hoverRemoveId === row.documentID;
  const isSummaryVisible =
    isSummaryOpen || summaryLoading || !!summaryError || !!summaryText;

  const exportChain = () => {
    const url = `${API_BASE}/chain-of-title-pdf/${row.documentID}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const legal = row.legalDescription?.trim();
  const remarks = row.remarks?.trim();
  const abstractTextVal = row.abstractText?.trim();
  const legalDisplayValue = legal || remarks || abstractTextVal || "—";
  const legalLabel = legal ? "Legal:" : remarks ? "Remarks:" : abstractTextVal ? "Abstract text:" : "Legal:";

  if (isRemoved) {
    return (
      <div
        key={row.documentID}
        className="result-row removed-placeholder"
        onClick={() => onUndoRemove(row.documentID)}
      >
        <div className="undo-message">Result removed. Click to undo</div>
      </div>
    );
  }

  return (
    <div
      key={row.documentID}
      className={`result-row ${isHovering ? "hover-remove" : ""}`}
    >
      <button
        className="remove-x-btn"
        onClick={() => onRemove(row.documentID)}
        onMouseEnter={() => setHoverRemoveId(row.documentID)}
        onMouseLeave={() => setHoverRemoveId(null)}
        title="Remove from results"
      >
        ×
      </button>

      <div className="doc-head">
        <div className="doc-title">
          <span className="doc-id">#{row.documentID}</span>
          <span className="doc-divider">•</span>
          <span className="mono">
            {row.book ?? "—"}/{row.volume || "—"}/{row.page || "—"}
          </span>
          {row.instrumentNumber && (
            <>
              <span className="doc-divider">•</span>
              <span className="doc-instrument">{row.instrumentNumber}</span>
            </>
          )}
        </div>
        <div className="badges">
          {row.instrumentType && (
            <span
              className="badge"
              style={{
                backgroundColor: getTypeColor(row.instrumentType).bg,
                color: getTypeColor(row.instrumentType).text,
                border: `1px solid ${getTypeColor(row.instrumentType).text}33`,
              }}
            >
              {row.instrumentType}
            </span>
          )}
          {row.propertyType && (
            <span
              className="badge"
              style={{
                backgroundColor: getTypeColor(row.propertyType).bg,
                color: getTypeColor(row.propertyType).text,
                border: `1px solid ${getTypeColor(row.propertyType).text}33`,
              }}
            >
              {row.propertyType}
            </span>
          )}
          {Number(row.exportFlag) === 2 && (
            <span
              className="badge"
              style={{
                backgroundColor: "#d1fae5",
                color: "#065f46",
                border: "1px solid #06594633",
              }}
            >
              AI Upload
            </span>
          )}
          {Number(row.exportFlag) === 1 && (
            <span
              className="badge"
              style={{
                backgroundColor: "#dbeafe",
                color: "#1e40af",
                border: "1px solid #1e40af33",
              }}
            >
              Manual Upload
            </span>
          )}
          {row.exportFlag != null && Number(row.exportFlag) === 0 && (
            <span
              className="badge"
              style={{
                backgroundColor: "#e5e7eb",
                color: "#4b5563",
                border: "1px solid #4b556333",
              }}
            >
              Pending
            </span>
          )}
        </div>
      </div>

      {isSummaryVisible && (
        <div className="summary-panel">
          <div className="summary-label">
            <b>AI Summary:</b>
          </div>
          <div className={`summary-content ${summaryLoading ? "is-loading" : ""}`}>
            {summaryLoading
              ? "Summarizing…"
              : summaryError
                ? summaryError
                : summaryText || "—"}
          </div>
        </div>
      )}

      <div className="doc-meta">
        <div className="kv wide">
          <b>Parties:</b>
          <span>
            {highlightText(row.grantors || row.grantor, searchTerms?.grantor)}{" "}
            <span className="muted">→</span>{" "}
            {highlightText(row.grantees || row.grantee, searchTerms?.grantee)}
          </span>
        </div>
        <div className="kv">
          <b>Filed:</b>{" "}
          <span className="mono">
            {highlightText(toDate(row.filingDate) ?? "—", searchTerms?.filingDate)}
          </span>
        </div>
        <div className="kv">
          <b>File Stamp:</b>{" "}
          <span className="mono">{toDate(row.fileStampDate) ?? "—"}</span>
        </div>
        {row.countyName && (
          <div className="kv">
            <b>County:</b> <span>{row.countyName}</span>
          </div>
        )}
      </div>

      {isEditing ? (
        <ResultEditForm editValues={editValues} setEditValues={setEditValues} />
      ) : (
        <div className="legal">
          <div className="legal-label">
            <b>{legalLabel}</b>
          </div>
          <div className="legal-content">
            {highlightText(legalDisplayValue, searchTerms?.legalDescription)}
          </div>
        </div>
      )}

      <div className="row-actions">
        {isEditing ? (
          <>
            <button
              className="btn tiny"
              onClick={() => onSaveEdit(row.documentID)}
            >
              Save
            </button>
            <button className="btn tiny ghost" onClick={onCancelEdit}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <div className="actions-left">
              <button
                className="btn tiny icon-btn"
                onClick={() =>
                  onPreviewPdf(row?.PRSERV, row?.countyName || "Washington")
                }
                title={
                  row?.PRSERV
                    ? `Preview ${row.PRSERV}.pdf`
                    : "No PRSERV available"
                }
                disabled={!row?.PRSERV}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
                  <circle cx="8" cy="8" r="2.5" />
                </svg>
              </button>
              <button
                className="btn tiny icon-btn"
                onClick={() =>
                  onDownloadPdf(row?.PRSERV, row?.countyName || "Washington")
                }
                title={
                  row?.PRSERV
                    ? `Download ${row.PRSERV}.pdf`
                    : "No PRSERV available"
                }
                disabled={!row?.PRSERV}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 1v10M8 11l-3-3M8 11l3-3" />
                  <path d="M2 11v2a2 2 0 002 2h8a2 2 0 002-2v-2" />
                </svg>
              </button>
              <button
                className="btn tiny icon-btn"
                onClick={() => onBeginEdit(row)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11.5 1.5l3 3L6 13H3v-3L11.5 1.5z" />
                </svg>
              </button>
              <button
                className="btn tiny danger"
                onClick={() => onDeleteRow(row.documentID)}
              >
                Delete
              </button>
              <button
                className="btn tiny ghost"
                onClick={() => onToggleSummary(row.documentID)}
                disabled={summaryLoading}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                {summaryLoading ? (
                  "Summarizing…"
                ) : (
                  <>
                    Summarize
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      stroke="none"
                    >
                      <path d="M8 0l1.5 3.5L13 5l-3.5 1.5L8 10l-1.5-3.5L3 5l3.5-1.5z" />
                      <path d="M11 9l0.75 1.75L13.5 11.5l-1.75 0.75L11 14l-0.75-1.75L8.5 11.5l1.75-0.75z" />
                    </svg>
                  </>
                )}
              </button>
            </div>
            <div className="actions-right">
              <button
                className="btn tiny ghost"
                onClick={exportChain}
                style={{ display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
                title="Export chain of title as PDF"
              >
                🔗 Chain
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
