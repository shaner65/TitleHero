import { useEffect, useMemo, useState } from "react";
import "./Dashboard.css";
import { isAdmin } from "../utils/auth";
import { UploadModal } from "./Dashboard/UploadComponents/UploadModal";
import { API_BASE } from "../constants/constants";
import type { FieldId } from "./Dashboard/types";
import type { ResultRow } from "./Dashboard/ResultsComponents/resultsTypes";
import { FIELD_DEFS } from "./Dashboard/constants";
import { Results } from "./Dashboard/ResultsComponents/Results";
import { UploadButton } from "./Dashboard/UploadComponents/UploadButton";
import { Header } from "./Dashboard/Header";
import { SearchForm } from "./Dashboard/SearchForm";
import { EmptySearchModal } from "./Dashboard/EmptySearchModal";
import { PdfLoadingOverlay } from "./Dashboard/PdfLoadingOverlay";

export default function Dashboard({ onNavigateToAdmin }: { onNavigateToAdmin?: () => void }) {
  const [active, setActive] = useState<FieldId[]>([]);

  const INITIAL_VALUES = useMemo(
    () => Object.fromEntries(FIELD_DEFS.map(f => [f.id, ""])) as Record<FieldId, string>,
    []
  );
  const [values, setValues] = useState<Record<FieldId, string>>(INITIAL_VALUES);

  const onChange = (id: FieldId, v: string) =>
    setValues(prev => ({ ...prev, [id]: v }));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [emptySearchError, setEmptySearchError] = useState(false);

  const [counties, setCounties] = useState<{ countyID: number; name: string }[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/county`)
      .then(res => res.json())
      .then(data => setCounties(data))
      .catch(e => console.error("Failed to fetch counties:", e));
  }, []);

  const submit = async (newOffset: number = 0) => {
    const hasSearchTerms = active.some(id => values[id]?.trim?.() ?? "");
    if (!hasSearchTerms) {
      setEmptySearchError(true);
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    for (const id of active) {
      const v = values[id]?.trim?.() ?? "";
      if (v) params.append(id, v);
    }
    params.append("offset", newOffset.toString());
    params.append("limit", "50");

    try {
      const res = await fetch(`${API_BASE}/documents/search?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Server ${res.status}: ${t}`);
      }
      const data = await res.json();
      const newRows = Array.isArray(data.rows) ? data.rows : [];
      if (newOffset === 0) {
        setResults(newRows);
      } else {
        setResults(prev => [...prev, ...newRows]);
      }
      setHasMore(newRows.length === 50);
      setOffset(newOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      if (newOffset === 0) setResults([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const adminMode = isAdmin();

  return (
    <div className="app">
      <aside className="sidebar">
        {adminMode && onNavigateToAdmin && (
          <button
            onClick={onNavigateToAdmin}
            className="btn-admin-sidebar"
            title="Manage Users"
          >
            Admin Panel
          </button>
        )}
      </aside>

      <UploadButton setShowUpload={setShowUpload} />

      <Header adminMode={adminMode} />

      <main className="main">
        <section className="card">
          <SearchForm
            active={active}
            setActive={setActive}
            values={values}
            onChange={onChange}
            counties={counties}
            onSubmit={() => submit()}
          />

          <Results
            counties={counties}
            setPdfLoading={setPdfLoading}
            results={results}
            loading={loading}
            error={error}
            offset={offset}
            hasMore={hasMore}
            submit={submit}
            searchTerms={values}
          />
        </section>
      </main>

      <UploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUploaded={() => {}}
      />

      <PdfLoadingOverlay show={pdfLoading} />

      <EmptySearchModal
        open={emptySearchError}
        onClose={() => setEmptySearchError(false)}
      />
    </div>
  );
}
