import { useEffect, useMemo, useState } from "react";
import "./Dashboard.css";
import { isAdmin } from "../utils/auth";
import { UploadModal } from "./Dashboard/UploadComponents/UploadModal";
import { API_BASE } from "../constants/constants";
import type { FieldId } from "./Dashboard/types";
import type { ResultRow } from "./Dashboard/ResultsComponents/resultsTypes";
import { COMMON_FIELD_IDS, FIELD_DEFS } from "./Dashboard/constants";
import { Results } from "./Dashboard/ResultsComponents/Results";
import { UploadButton } from "./Dashboard/UploadComponents/UploadButton";
import { Header } from "./Dashboard/Header";
import { SearchForm } from "./Dashboard/SearchForm";
import { EmptySearchModal } from "./Dashboard/EmptySearchModal";
import { PdfLoadingOverlay } from "./Dashboard/PdfLoadingOverlay";

export default function Dashboard({ onNavigateToAdmin }: { onNavigateToAdmin?: () => void }) {
  const SAVED_SEARCHES_KEY = "titlehero.savedSearches";

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
  const [savedSearches, setSavedSearches] = useState<
    { id: string; name: string; active: FieldId[]; values: Partial<Record<FieldId, string>>; createdAt: string; lastRun?: string }[]
  >([]);
  const [loadedSearchName, setLoadedSearchName] = useState<string | null>(null);
  const [loadedSearchLastRun, setLoadedSearchLastRun] = useState<string | null>(null);

  const loadSavedSearches = (): typeof savedSearches => {
    try {
      const raw = localStorage.getItem(SAVED_SEARCHES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const persistSavedSearches = (next: typeof savedSearches) => {
    setSavedSearches(next);
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
  };

  useEffect(() => {
    fetch(`${API_BASE}/county`)
      .then(res => res.json())
      .then(data => setCounties(data))
      .catch(e => console.error("Failed to fetch counties:", e));
  }, []);

  useEffect(() => {
    setSavedSearches(loadSavedSearches());
  }, []);

  const submit = async (newOffset: number = 0, options?: { updatedSince?: string }) => {
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
    if (options?.updatedSince) {
      params.append("updatedSince", options.updatedSince);
    }

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
      
      // Update lastRun for loaded saved search
      if (loadedSearchName && newOffset === 0) {
        updateSearchLastRun(loadedSearchName);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      if (newOffset === 0) setResults([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSearch = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const entries = Object.entries(values).filter(([, v]) => v && v.trim());
    if (entries.length === 0) {
      alert("Add at least one value to save a search.");
      return;
    }

    const savedValues = Object.fromEntries(entries) as Partial<Record<FieldId, string>>;
    const activeFromValues = entries.map(([id]) => id as FieldId);
    const existingIndex = savedSearches.findIndex(
      (s) => s.name.toLowerCase() === trimmed.toLowerCase()
    );
    const newSearch = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      active: activeFromValues,
      values: savedValues,
      createdAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      const shouldOverwrite = window.confirm(
        `A saved search named "${trimmed}" already exists. Overwrite it?`
      );
      if (!shouldOverwrite) return;
      const next = [...savedSearches];
      next[existingIndex] = { ...newSearch, id: savedSearches[existingIndex].id };
      persistSavedSearches(next);
      return;
    }

    persistSavedSearches([newSearch, ...savedSearches]);
  };

  const handleLoadSearch = (id: string) => {
    const saved = savedSearches.find((s) => s.id === id);
    if (!saved) return;
    const nextActive = Array.from(new Set([...COMMON_FIELD_IDS, ...saved.active]));
    setActive(nextActive);
    setValues({ ...INITIAL_VALUES, ...saved.values });
    setLoadedSearchName(saved.name);
    setLoadedSearchLastRun(saved.lastRun || null);
  };

  const updateSearchLastRun = (searchName: string) => {
    const now = new Date().toISOString();
    const updated = savedSearches.map((s) =>
      s.name === searchName ? { ...s, lastRun: now } : s
    );
    persistSavedSearches(updated);
    setLoadedSearchLastRun(now);
  };

  const clearLoadedSearch = () => {
    setLoadedSearchName(null);
    setLoadedSearchLastRun(null);
  };

  const handleDeleteSearch = (id: string) => {
    const saved = savedSearches.find((s) => s.id === id);
    if (!saved) return;
    const shouldDelete = window.confirm(`Delete saved search "${saved.name}"?`);
    if (!shouldDelete) return;
    persistSavedSearches(savedSearches.filter((s) => s.id !== id));
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
            onChange={(id, v) => {
              onChange(id, v);
              // Clear loaded search info when user modifies form
              if (loadedSearchName) clearLoadedSearch();
            }}
            counties={counties}
            onSubmit={(options) => submit(0, options)}
            savedSearches={savedSearches.map(({ id, name }) => ({ id, name }))}
            onSaveSearch={handleSaveSearch}
            onLoadSearch={handleLoadSearch}
            onDeleteSearch={handleDeleteSearch}
            loadedSearchName={loadedSearchName}
            loadedSearchLastRun={loadedSearchLastRun}
            onClearLoadedSearch={clearLoadedSearch}
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
