import { useEffect, useMemo, useRef, useState } from "react";
import "./Dashboard.css";
import { isAdmin } from "../utils/auth";
import React from "react";
import { UploadModal } from "./Dashboard/UploadComponents/UploadModal";
import { API_BASE } from "../constants/constants";
import type { FieldId } from "./Dashboard/types";
import { FIELD_DEFS } from "./Dashboard/constants";
import { Results } from "./Dashboard/ResultsComponents/Results";
import { UploadButton } from "./Dashboard/UploadComponents/UploadButton";

/* ----------------------- Dashboard ----------------------- */
export default function Dashboard({ onNavigateToAdmin }: { onNavigateToAdmin?: () => void }) {
  // Start with your original common set; user can "Select all" from dropdown.
  const [active, setActive] = useState<FieldId[]>(["criteria"]);

  // User initials for header avatar label
  const getInitials = () => {
    if (typeof window === "undefined") return "USER";
    const stored = (localStorage.getItem("username") || "").trim();
    const chars = stored.slice(0, 3).toUpperCase();
    const masked = chars + "*".repeat(Math.max(0, 6 - chars.length));
    return masked || "USER";
  };
  const userInitials = getInitials();

  // Initialize values for all fields to empty strings
  const INITIAL_VALUES = useMemo(
    () => Object.fromEntries(FIELD_DEFS.map(f => [f.id, ""])) as Record<FieldId, string>,
    []
  );
  const [values, setValues] = useState<Record<FieldId, string>>(INITIAL_VALUES);

  // Dropdown open/close
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const activeSet = useMemo(() => new Set(active), [active]);

  const toggleField = (id: FieldId) => {
    setActive(prev => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter(x => x !== id) : [...prev, id];
      if (!exists) queueMicrotask(() => document.getElementById(`field-${id}`)?.focus());
      return next;
    });
  };

  // NEW: refs/state near your other hooks
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [dropUp, setDropUp] = useState(false);

  // inline style for the fixed panel
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  // Recalc placement whenever opened / resized / scrolled
  useEffect(() => {
    function recalc() {
      if (!menuOpen || !triggerRef.current) return;

      const trg = triggerRef.current.getBoundingClientRect();
      const padding = 12; // viewport padding
      const desiredWidth = Math.min(900, window.innerWidth * 0.86);

      // Try to place below first
      const spaceBelow = window.innerHeight - trg.bottom - padding;
      const belowMaxH = Math.min(window.innerHeight * 0.6, spaceBelow);
      const openBelow = belowMaxH >= 240; // needs ~enough room

      let top = 0;
      const left = Math.min(
        Math.max(trg.left, padding),
        window.innerWidth - desiredWidth - padding
      );
      let maxHeight = 0;

      if (openBelow) {
        top = trg.bottom + 8; // a little gap
        maxHeight = Math.max(260, belowMaxH); // clamp
        setDropUp(false);
      } else {
        // open upward
        const spaceAbove = trg.top - padding;
        maxHeight = Math.min(window.innerHeight * 0.6, spaceAbove - 8);
        top = Math.max(padding, trg.top - maxHeight - 8);
        setDropUp(true);
      }

      setMenuStyle({
        top,
        left,
        maxHeight,
        width: desiredWidth
      });
    }

    recalc();
    window.addEventListener("resize", recalc);
    window.addEventListener("scroll", recalc, true);
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("scroll", recalc, true);
    };
  }, [menuOpen]);

  // Close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const onChange = (id: FieldId, v: string) =>
    setValues(prev => ({ ...prev, [id]: v }));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // County list and filter
  const [counties, setCounties] = useState<{ countyID: number; name: string }[]>([]);

  // Fetch counties on mount
  useEffect(() => {
    fetch(`${API_BASE}/county`)
      .then(res => res.json())
      .then(data => setCounties(data))
      .catch(e => console.error('Failed to fetch counties:', e));
  }, []);



  // NEW: upload modal state
  const [showUpload, setShowUpload] = useState(false);

  // PDF loading state
  const [pdfLoading, setPdfLoading] = useState(false);

  // submitting function, then using the search from documents.js
  const submit = async (newOffset: number = 0) => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    for (const id of active) {
      const v = values[id]?.trim?.() ?? "";
      if (v) params.append(id, v);
    }
    params.append('offset', newOffset.toString());
    params.append('limit', '50');

    try {
      const res = await fetch(`${API_BASE}/documents/search?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
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
      // If we got 50 results, there might be more. If we got less than 50, we've reached the end.
      setHasMore(newRows.length === 50);
      setOffset(newOffset);
    } catch (e: any) {
      setError(e?.message || 'Search failed');
      if (newOffset === 0) setResults([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const adminMode = isAdmin();

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        {/* <img src="/TITLE HERO TRANSPARENT LOGO.png" alt="Title Hero" className="sidebar-logo" /> */}

        <UploadButton setShowUpload={setShowUpload}/>
      </aside>

      {/* Header */}
      <header className="header">
        <img src="/TITLE HERO TRANSPARENT LOGO.png" alt="Title Hero" className="sidebar-logo" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '20px' }}>
          <div className="breadcrumbs">DASHBOARD</div>
          {adminMode && <span style={{ color: '#ff4444', fontWeight: 'bold', fontSize: '10px' }}>ADMIN MODE</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {adminMode && onNavigateToAdmin && (
              <button 
                onClick={onNavigateToAdmin}
                className="btn-admin"
                title="Manage Users"
              >
                Admin Panel
              </button>
            )}
            <div className="profile">
              <div>{userInitials}</div>
              <div className="avatar" />
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="main">
        <section className="card">
          <div className="search-title">SEARCH</div>
          <form className="search-grid" onSubmit={(e) => e.preventDefault()}>
            {FIELD_DEFS.filter(f => activeSet.has(f.id)).map(f => (
              <div key={f.id} className={`field ${spanClass(f.span)}`} data-active>
                <label htmlFor={`field-${f.id}`}>{f.label}</label>
                {f.type === "textarea" ? (
                  <textarea
                    id={`field-${f.id}`}
                    className="textarea"
                    placeholder={f.placeholder}
                    value={values[f.id]}
                    onChange={(e) => onChange(f.id, e.target.value)}
                  />
                ) : f.type === "select" && f.id === "countyName" ? (
                  <select
                    id={`field-${f.id}`}
                    className="input"
                    value={values[f.id]}
                    onChange={(e) => onChange(f.id, e.target.value)}
                  >
                    <option value="">{f.placeholder}</option>
                    {counties.map(county => (
                      <option key={county.countyID} value={county.name}>
                        {county.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`field-${f.id}`}
                    className="input"
                    placeholder={f.placeholder}
                    value={values[f.id]}
                    onChange={(e) => onChange(f.id, e.target.value)}
                  />
                )}
              </div>
            ))}

            {/* Actions */}
            <div className="actions col-12">
              <div className="dropdown" ref={menuRef}>
                <button
                  type="button"
                  className="btn icon"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(v => !v)}
                  ref={triggerRef}
                >
                  ▾
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    className={`dropdown-menu ${dropUp ? "drop-up" : ""}`}
                    aria-label="Select fields to search by"
                    style={menuStyle}
                  >
                    <div className="dropdown-title">Search by…</div>

                    {FIELD_DEFS.map(f => (
                      <label key={f.id} className="dropdown-item">
                        <input
                          type="checkbox"
                          checked={activeSet.has(f.id)}
                          onChange={() => toggleField(f.id)}
                        />
                        <span>{f.label}</span>
                      </label>
                    ))}

                    <div className="dropdown-footer">
                      <button
                        type="button"
                        className="btn tiny"
                        onClick={() => setActive(FIELD_DEFS.map(f => f.id))}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="btn tiny"
                        onClick={() => setActive([])}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button type="button" className="btn btn-primary" onClick={() => submit()}>
                SEARCH
              </button>
            </div>
          </form>

          {/* Results scaffold */}
          <Results
            counties={counties}
            setPdfLoading={setPdfLoading}
            results={results}
            setResults={setResults}
            loading={loading}
            error={error}
            offset={offset}
            hasMore={hasMore}
            submit={submit}
          />
        </section>
      </main>

      {/* Upload modal */}
      <UploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUploaded={() => {
          // Optional: re-run search to show new records right away
          // submit();
        }}
      />

      {pdfLoading && (
        <div className="pdf-loading-overlay">
          <div className="pdf-loading-dialog">
            <div className="loading-spinner"></div>
            <div className="loading-text">Opening document…</div>
          </div>
        </div>
      )}

    </div>
  );
}

function spanClass(span: number) {
  if (span === 12) return "col-12";
  if (span === 8) return "col-8";
  if (span === 6) return "col-6";
  if (span === 4) return "col-4";
  if (span === 3) return "col-3";
  return "col-12";
}