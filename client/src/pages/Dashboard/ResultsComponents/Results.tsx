import { useState, useMemo } from "react";
import { API_BASE } from "../../../constants/constants";
import { ResultsHeader } from "./ResultsHeader";
import { HelpModal } from "./HelpModal";
import { ResultFilters } from "./Filters";
import { ResultRow } from "./ResultRow";
import { useResultFilters } from "./useResultFilters";
import type { ResultsProp, ResultRow as ResultRowType, EditValues } from "./resultsTypes";
import { EMPTY_EDIT_VALUES } from "./resultsTypes";

export function Results({
  counties,
  setPdfLoading,
  results,
  loading,
  error,
  offset,
  hasMore,
  submit,
  searchTerms,
}: ResultsProp) {
  const [showHelp, setShowHelp] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [hoverRemoveId, setHoverRemoveId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<EditValues>(EMPTY_EDIT_VALUES);
  const [summaryById, setSummaryById] = useState<Record<number, string>>({});
  const [summaryLoadingById, setSummaryLoadingById] = useState<
    Record<number, boolean>
  >({});
  const [summaryErrorById, setSummaryErrorById] = useState<
    Record<number, string>
  >({});
  const [summaryOpenIds, setSummaryOpenIds] = useState<Set<number>>(new Set());

  const filters = useResultFilters();
  const {
    filterDateFrom,
    filterDateTo,
    filterDocType,
    sortDocType,
    filterCounty,
    setFilterDateFrom,
    setFilterDateTo,
    setFilterCounty,
    setFilterDocType,
    setSortDocType,
    clearAllFilters,
  } = filters;

  const filteredResults = useMemo(() => {
    const filtered = results.filter((row) => {
      if (filterDateFrom || filterDateTo) {
        const filingDate = row.filingDate ? new Date(row.filingDate) : null;
        if (!filingDate) return false;
        if (filterDateFrom && filingDate < new Date(filterDateFrom))
          return false;
        if (filterDateTo && filingDate > new Date(filterDateTo)) return false;
      }
      if (filterDocType) {
        const t = (row.instrumentType || "").toString().toLowerCase();
        if (!t.includes(filterDocType.toLowerCase())) return false;
      }
      if (filterCounty && row.countyName !== filterCounty) return false;
      return true;
    });

    if (sortDocType === "none") return filtered;
    const sorted = [...filtered].sort((a, b) => {
      const ta = (a.instrumentType || "").toString().toLowerCase();
      const tb = (b.instrumentType || "").toString().toLowerCase();
      if (ta === tb) return 0;
      return sortDocType === "asc"
        ? ta < tb ? -1 : 1
        : ta > tb ? -1 : 1;
    });
    return sorted;
  }, [results, filterDateFrom, filterDateTo, filterDocType, sortDocType, filterCounty]);

  function removeFromList(id: number) {
    setRemovedIds((prev) => new Set(prev).add(id));
    setHoverRemoveId(null);
  }

  function undoRemove(id: number) {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setHoverRemoveId(null);
  }

  function previewPdf(prefix?: string | null, countyName?: string | null) {
    if (!prefix?.trim()) {
      alert("No PRSERV prefix available for this record.");
      return;
    }
    setPdfLoading(true);
    const params = new URLSearchParams({ prefix: prefix.trim() });
    if (countyName?.trim()) params.append("countyName", countyName.trim());
    window.open(`${API_BASE}/documents/pdf?${params.toString()}`, "_blank", "noopener,noreferrer");
    setTimeout(() => setPdfLoading(false), 2000);
  }

  function downloadPdf(prefix?: string | null, countyName?: string | null) {
    if (!prefix?.trim()) {
      alert("No PRSERV prefix available for this record.");
      return;
    }
    setPdfLoading(true);
    const params = new URLSearchParams({
      prefix: prefix.trim(),
      download: "true",
    });
    if (countyName?.trim()) params.append("countyName", countyName.trim());
    window.open(`${API_BASE}/documents/pdf?${params.toString()}`, "_blank", "noopener,noreferrer");
    setTimeout(() => setPdfLoading(false), 4000);
  }

  async function fetchSummary(documentID: number) {
    setSummaryLoadingById((prev) => ({ ...prev, [documentID]: true }));
    setSummaryErrorById((prev) => ({ ...prev, [documentID]: "" }));
    try {
      const res = await fetch(`${API_BASE}/documents/${documentID}/summary`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Summary failed (${res.status}): ${t}`);
      }
      const data = await res.json();
      const summary = (data?.summary ?? "").toString().trim() || "—";
      setSummaryById((prev) => ({ ...prev, [documentID]: summary }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to summarize";
      setSummaryErrorById((prev) => ({ ...prev, [documentID]: message }));
    } finally {
      setSummaryLoadingById((prev) => ({ ...prev, [documentID]: false }));
    }
  }

  function toggleSummary(documentID: number) {
    setSummaryOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(documentID)) next.delete(documentID);
      else next.add(documentID);
      return next;
    });
    if (!summaryById[documentID] && !summaryLoadingById[documentID]) {
      fetchSummary(documentID);
    }
  }

  async function saveEdit(id: number) {
    try {
      const res = await fetch(`${API_BASE}/documents/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(editValues),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Update failed (${res.status}): ${t}`);
      }
      await submit();
      setEditId(null);
      setEditValues(EMPTY_EDIT_VALUES);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to update";
      alert(message);
    }
  }

  function beginEdit(row: ResultRowType) {
    setEditId(row.documentID);
    setEditValues({
      instrumentNumber: row.instrumentNumber ?? "",
      grantor: row.grantor ?? "",
      grantee: row.grantee ?? "",
      instrumentType: row.instrumentType ?? "",
      book: row.book ?? "",
      volume: row.volume ?? "",
      page: row.page ?? "",
      legalDescription: row.legalDescription ?? "",
      remarks: row.remarks ?? "",
      address: row.address ?? "",
      filingDate: row.filingDate ?? "",
      fileStampDate: row.fileStampDate ?? "",
      exportFlag: row.exportFlag ?? 0,
    });
  }

  function cancelEdit() {
    setEditId(null);
    setEditValues(EMPTY_EDIT_VALUES);
  }

  return (
    <div className="results">
      <ResultsHeader
        loading={loading}
        filteredResults={filteredResults}
        showHelp={showHelp}
        setShowHelp={setShowHelp}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        error={error}
        clearAllFilters={clearAllFilters}
      />

      {showHelp && <HelpModal setShowHelp={setShowHelp} />}

      {showFilters && (
        <ResultFilters
          filterDateFrom={filterDateFrom}
          setFilterDateFrom={setFilterDateFrom}
          filterDateTo={filterDateTo}
          setFilterDateTo={setFilterDateTo}
          filterCounty={filterCounty}
          setFilterCounty={setFilterCounty}
          filterDocType={filterDocType}
          setFilterDocType={setFilterDocType}
          sortDocType={sortDocType}
          setSortDocType={setSortDocType}
          counties={counties}
          clearAllFilters={clearAllFilters}
        />
      )}

      {filteredResults.length === 0 && !loading && !error && (
        <div className="result-row" style={{ background: "#f3efec" }}>
          {results.length > 0
            ? "No matches for current filters."
            : "No matches."}
        </div>
      )}

      {loading && (
        <div className="loading-container">
          <div className="loading-spinner" />
          <div className="loading-text">Searching…</div>
        </div>
      )}

      {filteredResults.map((row) => (
        <ResultRow
          key={row.documentID}
          row={row}
          searchTerms={searchTerms}
          isRemoved={removedIds.has(row.documentID)}
          onRemove={removeFromList}
          onUndoRemove={undoRemove}
          hoverRemoveId={hoverRemoveId}
          setHoverRemoveId={setHoverRemoveId}
          isEditing={editId === row.documentID}
          editValues={editValues}
          setEditValues={setEditValues}
          onBeginEdit={beginEdit}
          onCancelEdit={cancelEdit}
          onSaveEdit={saveEdit}
          summaryText={summaryById[row.documentID]}
          summaryLoading={!!summaryLoadingById[row.documentID]}
          summaryError={summaryErrorById[row.documentID]}
          isSummaryOpen={summaryOpenIds.has(row.documentID)}
          onToggleSummary={toggleSummary}
          onPreviewPdf={previewPdf}
          onDownloadPdf={downloadPdf}
        />
      ))}

      {hasMore && (
        <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}>
          <button
            className="btn"
            onClick={() => submit(offset + 50)}
            disabled={loading}
            style={{ minWidth: "150px" }}
          >
            {loading ? "Loading…" : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
