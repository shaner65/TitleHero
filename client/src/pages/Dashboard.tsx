import { useEffect, useMemo, useRef, useState } from "react";
import "./Dashboard.css";
import { isAdmin } from "../utils/auth";
import React from "react";
import { UploadModal } from "./UploadComponents/UploadModal";

const API_BASE = import.meta.env.DEV ? '/api' : (import.meta.env.VITE_API_TARGET || 'https://5mj0m92f17.execute-api.us-east-2.amazonaws.com/api');

/** All searchable fields from DB (ids match DB keys exactly) */
const FIELD_DEFS = [
  // IDs / references
  { id: "documentID", label: "DOCUMENT ID", placeholder: "e.g., 6", type: "input", span: 3 },
  { id: "abstractCode", label: "ABSTRACT CODE", placeholder: "e.g., 42", type: "input", span: 3 },
  // { id: "bookTypeID", label: "BOOK TYPE ID", placeholder: "e.g., 1", type: "input", span: 3 },
  // { id: "subdivisionID", label: "SUBDIVISION ID", placeholder: "e.g., 17", type: "input", span: 3 },
  { id: "countyID", label: "COUNTY ID", placeholder: "e.g., 123", type: "input", span: 3 },

  // Instrument / book meta
  { id: "instrumentNumber", label: "INSTRUMENT NUMBER", placeholder: "e.g., IN12345", type: "input", span: 4 },
  { id: "book", label: "BOOK", placeholder: "e.g., Book A", type: "input", span: 3 },
  { id: "volume", label: "VOLUME", placeholder: "e.g., Vol 1", type: "input", span: 3 },
  { id: "page", label: "PAGE", placeholder: "e.g., 12", type: "input", span: 3 },

  // Parties / instrument type
  { id: "grantor", label: "GRANTOR", placeholder: "e.g., John Doe", type: "input", span: 4 },
  { id: "grantee", label: "GRANTEE", placeholder: "e.g., Jane Smith", type: "input", span: 4 },
  { id: "instrumentType", label: "INSTRUMENT TYPE", placeholder: "e.g., Deed", type: "input", span: 4 },

  // Amounts / numbers
  { id: "lienAmount", label: "LIEN AMOUNT", placeholder: "e.g., 50000.75", type: "input", span: 3 },
  { id: "acres", label: "ACRES", placeholder: "e.g., 2.5000", type: "input", span: 3 },
  { id: "exportFlag", label: "EXPORT FLAG", placeholder: "0 or 1", type: "input", span: 3 },
  { id: "GFNNumber", label: "GF NUMBER", placeholder: "e.g., 123", type: "input", span: 3 },
  { id: "marketShare", label: "MARKET SHARE", placeholder: "e.g., 50%", type: "input", span: 3 },

  // Legal / description blocks
  { id: "legalDescription", label: "LEGAL DESCRIPTION", placeholder: "Lot 1, Block A...", type: "textarea", span: 8 },
  { id: "subBlock", label: "SUB BLOCK", placeholder: "e.g., Block A", type: "input", span: 3 },
  { id: "abstractText", label: "ABSTRACT TEXT", placeholder: "Abstract text...", type: "textarea", span: 8 },
  { id: "fieldNotes", label: "FIELD NOTES", placeholder: "Field notes...", type: "textarea", span: 8 },
  { id: "remarks", label: "REMARKS", placeholder: "Remarks...", type: "textarea", span: 8 },

  // Dates / finalized
  { id: "fileStampDate", label: "FILE STAMP DATE", placeholder: "YYYY-MM-DD or ISO", type: "input", span: 4 },
  { id: "filingDate", label: "FILING DATE", placeholder: "YYYY-MM-DD or ISO", type: "input", span: 4 },
  { id: "finalizedBy", label: "FINALIZED BY", placeholder: "e.g., Admin User", type: "input", span: 4 },

  // Other references
  { id: "nFileReference", label: "N FILE REFERENCE", placeholder: "e.g., NF123456", type: "input", span: 4 },
  { id: "propertyType", label: "PROPERTY TYPE", placeholder: "e.g., Residential", type: "input", span: 4 },
  { id: "sortArray", label: "SORT ARRAY", placeholder: "e.g., [1,2,3]", type: "input", span: 4 },

  // Location / CAD / links
  { id: "address", label: "ADDRESS", placeholder: "e.g., 123 Main Street", type: "input", span: 6 },
  { id: "CADNumber", label: "CAD NUMBER", placeholder: "e.g., CAD001", type: "input", span: 3 },
  // { id: "CADNumber2", label: "CAD NUMBER 2", placeholder: "e.g., CAD002", type: "input", span: 3 },
  { id: "GLOLink", label: "GLO LINK", placeholder: "http://...", type: "input", span: 6 },

  // Timestamps
  { id: "created_at", label: "CREATED AT", placeholder: "ISO timestamp", type: "input", span: 4 },
  { id: "updated_at", label: "UPDATED AT", placeholder: "ISO timestamp", type: "input", span: 4 },

  // Optional freeform criteria (kept from your original UI)
  { id: "criteria", label: "SEARCH ALL FIELDS", placeholder: "", type: "textarea", span: 6 },
] as const;

type FieldId = typeof FIELD_DEFS[number]["id"];

interface AdminFormData {
  name: string;
  password: string;
  role: string;
  permissions: string[];
}

function AdminSignupForm() {
  const [form, setForm] = useState<AdminFormData>({
    name: "",
    password: "",
    role: "admin",
    permissions: [],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      console.log("Submitting signup form:", form);
      const res = await fetch(`${API_BASE}/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          username: form.name,
          password: form.password,
          isAdmin: form.role === "admin" ? true : false,
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Server ${res.status}: ${t}`);
      }

      const data = await res.json();
      console.log("Signup success:", data);

      setForm({
        name: "",
        password: "",
        role: "user",
        permissions: [],
      });

    } catch (e: any) {
      console.error(e?.message || "Signup failed");
    }
  };

  return (
    <div className="signup-container">
      <h2 >Add Users</h2>
      <form
        onSubmit={handleSubmit}

      >
        <div>
          <label>Username: </label>
          <input
            type="text"

            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>

        <div>
          <label>Password: </label>
          <input
            type="password"

            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </div>

        <div>
          <label>Role: </label>
          <select

            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <button
          type="submit"

        >
          Create User
        </button>
      </form>
    </div>
  );
}

/* ----------------------- Dashboard ----------------------- */
export default function Dashboard() {
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

  // Color coding for document types
  const getTypeColor = (type: string | null | undefined): { bg: string; text: string } => {
    if (!type) return { bg: '#e8eef9', text: '#2c4771' };
    const normalized = String(type).toLowerCase().trim();
    const colorMap: Record<string, { bg: string; text: string }> = {
      // Warranty deeds -> Yellow
      'warranty deed': { bg: '#fcd34d', text: '#854d0e' },
      'wd': { bg: '#fcd34d', text: '#854d0e' },
      'swd': { bg: '#fcd34d', text: '#854d0e' },
      'special warranty deed': { bg: '#fcd34d', text: '#854d0e' },
      'general warranty deed': { bg: '#fcd34d', text: '#854d0e' },
      'd': { bg: '#fcd34d', text: '#854d0e' },

      // Deeds of trust -> Green
      'deed of trust': { bg: '#86efac', text: '#166534' },
      'dot': { bg: '#86efac', text: '#166534' },
      'trust deed': { bg: '#86efac', text: '#166534' },
      'td': { bg: '#86efac', text: '#166534' },

      // Easements & mineral leases/deeds -> Blue
      'easement': { bg: '#93c5fd', text: '#1e3a8a' },
      'esm': { bg: '#93c5fd', text: '#1e3a8a' },
      'esmt': { bg: '#93c5fd', text: '#1e3a8a' },
      'mineral lease': { bg: '#93c5fd', text: '#1e3a8a' },
      'mineral leases': { bg: '#93c5fd', text: '#1e3a8a' },
      'mineral deed': { bg: '#93c5fd', text: '#1e3a8a' },
      'mineral deeds': { bg: '#93c5fd', text: '#1e3a8a' },

      // Releases -> Grey
      'release': { bg: '#e5e7eb', text: '#374151' },
      'rel': { bg: '#e5e7eb', text: '#374151' },
      'rln': { bg: '#e5e7eb', text: '#374151' },
      'discharge': { bg: '#e5e7eb', text: '#374151' },
    };
    return colorMap[normalized] || { bg: '#e8eef9', text: '#2c4771' };
  };

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

  // Track removed results and hover state
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [hoverRemoveId, setHoverRemoveId] = useState<number | null>(null);

  // County list and filter
  const [counties, setCounties] = useState<{ countyID: number; name: string }[]>([]);
  const [filterCounty, setFilterCounty] = useState<string>("");

  // Fetch counties on mount
  useEffect(() => {
    fetch(`${API_BASE}/county`)
      .then(res => res.json())
      .then(data => setCounties(data))
      .catch(e => console.error('Failed to fetch counties:', e));
  }, []);

  // Filter state for results
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");
  const [filterDocType, setFilterDocType] = useState<string>("");
  const [sortDocType, setSortDocType] = useState<'none' | 'asc' | 'desc'>('none');

  const clearAllFilters = () => {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterDocType("");
    setSortDocType('none');
    setFilterCounty("");
  };

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

  // Filter results based on filter criteria
  const filteredResults = useMemo(() => {
    const filtered = results.filter(row => {
      // Filter by date range
      if (filterDateFrom || filterDateTo) {
        const filingDate = row.filingDate ? new Date(row.filingDate) : null;
        if (!filingDate) return false;

        if (filterDateFrom) {
          const fromDate = new Date(filterDateFrom);
          if (filingDate < fromDate) return false;
        }

        if (filterDateTo) {
          const toDate = new Date(filterDateTo);
          if (filingDate > toDate) return false;
        }
      }

      // Filter by document type substring match
      if (filterDocType) {
        const t = (row.instrumentType || '').toString().toLowerCase();
        if (!t.includes(filterDocType.toLowerCase())) return false;
      }

      // Filter by county
      if (filterCounty) {
        if (row.countyName !== filterCounty) return false;
      }

      return true;
    });

    // Apply document type sort
    let sorted = filtered;
    if (sortDocType !== 'none') {
      sorted = [...filtered].sort((a, b) => {
        const ta = (a.instrumentType || '').toString().toLowerCase();
        const tb = (b.instrumentType || '').toString().toLowerCase();
        if (ta === tb) return 0;
        if (sortDocType === 'asc') return ta < tb ? -1 : 1;
        return ta > tb ? -1 : 1;
      });
    }

    return sorted;
  }, [results, filterDateFrom, filterDateTo, filterDocType, sortDocType, filterCounty]);

  //stuff for editing and deleting

  // Editing state
  const [editId, setEditId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<any>({});

  // API_BASE is defined at top for both dev and prod

  function beginEdit(row: any) {
    setEditId(row.documentID);
    setEditValues({
      instrumentNumber: row.instrumentNumber ?? '',
      grantor: row.grantor ?? '',
      grantee: row.grantee ?? '',
      instrumentType: row.instrumentType ?? '',
      book: row.book ?? '',
      volume: row.volume ?? '',
      page: row.page ?? '',
      legalDescription: row.legalDescription ?? '',
      remarks: row.remarks ?? '',
      address: row.address ?? '',
      filingDate: row.filingDate ?? '',
      fileStampDate: row.fileStampDate ?? '',
      exportFlag: row.exportFlag ?? 0
    });
  }

  function cancelEdit() {
    setEditId(null);
    setEditValues({});
  }

  async function saveEdit(id: number) {
    try {
      const res = await fetch(`${API_BASE}/documents/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(editValues)
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Update failed (${res.status}): ${t}`);
      }
      // refresh current results (cheap: re-run last search)
      await submit();
      cancelEdit();
    } catch (e: any) {
      alert(e?.message || 'Failed to update');
    }
  }

  async function deleteRow(id: number) {
    if (!confirm(`Delete document ${id}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${API_BASE}/documents/${id}`, {
        method: 'DELETE',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Delete failed (${res.status}): ${t}`);
      }
      // remove from UI or refresh
      setResults(prev => prev.filter(r => r.documentID !== id));
    } catch (e: any) {
      alert(e?.message || 'Failed to delete');
    }
  }

  function removeFromList(id: number) {
    // Mark as removed without deleting from database
    setRemovedIds(prev => new Set(prev).add(id));
    setHoverRemoveId(null); // Clear hover state
  }

  function undoRemove(id: number) {
    // Restore removed result
    setRemovedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setHoverRemoveId(null); // Clear hover state
  }

  function previewPdf(prefix?: string | null, countyName?: string | null) {
    if (!prefix || !prefix.trim()) {
      alert("No PRSERV prefix available for this record.");
      return;
    }
    setPdfLoading(true);
    const params = new URLSearchParams({ prefix: prefix.trim() });
    if (countyName && countyName.trim()) {
      params.append('countyName', countyName.trim());
    }
    const url = `${API_BASE}/documents/pdf?${params.toString()}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => setPdfLoading(false), 2000);
  }

  function downloadPdf(prefix?: string | null, countyName?: string | null) {
    if (!prefix || !prefix.trim()) {
      alert("No PRSERV prefix available for this record.");
      return;
    }
    setPdfLoading(true);
    const params = new URLSearchParams({ prefix: prefix.trim(), download: 'true' });
    if (countyName && countyName.trim()) {
      params.append('countyName', countyName.trim());
    }
    const url = `${API_BASE}/documents/pdf?${params.toString()}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => setPdfLoading(false), 4000);
  }



  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        {/* <img src="/TITLE HERO TRANSPARENT LOGO.png" alt="Title Hero" className="sidebar-logo" /> */}

        {adminMode && <AdminSignupForm />}

        <button
          className="upload-btn"
          onClick={() => setShowUpload(true)}
          aria-label="Upload"
          title="Upload"
        >
          ↑
        </button>
      </aside>

      {/* Header */}
      <header className="header">
        <img src="/TITLE HERO TRANSPARENT LOGO.png" alt="Title Hero" className="sidebar-logo" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '20px' }}>
          <div className="breadcrumbs">DASHBOARD</div>
          {adminMode && <span style={{ color: '#ff4444', fontWeight: 'bold', fontSize: '10px' }}>ADMIN MODE</span>}
          <div className="profile">
            <div>{userInitials}</div>
            <div className="avatar" />
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
          <div className="results">
            <div className="results-header">
              <div className="results-title">
                RESULTS {loading ? '…' : `(${filteredResults.length}/${filteredResults.length})`}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  className="btn tiny filter-icon-btn"
                  onClick={() => setShowHelp(!showHelp)}
                  title="Color Legend"
                  style={{ fontSize: '16px', fontWeight: 'bold' }}
                >
                  ?
                </button>
                <button
                  className="btn tiny filter-icon-btn"
                  onClick={() => setShowFilters(!showFilters)}
                  title={showFilters ? 'Hide Filters' : 'Show Filters'}
                >
                  ☰
                </button>
                {error && <div className="filter-pill" style={{ color: '#b00' }}>{error}</div>}
                <button
                  className="btn tiny ghost"
                  onClick={clearAllFilters}
                  title="Reset filters"
                  style={{ marginLeft: '4px' }}
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Help Modal */}
            {showHelp && (
              <div className="help-panel">
                <div className="help-header">
                  <div>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>Understanding Your Results</h4>
                    <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--ink-subtle)' }}>Quick guide to the search results layout</p>
                  </div>
                  <button
                    className="btn tiny"
                    onClick={() => setShowHelp(false)}
                    style={{ padding: '6px 10px', fontSize: '14px' }}
                  >
                    ✕
                  </button>
                </div>
                <div className="help-content">
                  <div className="help-section">
                    <div className="help-label">Header Line</div>
                    <div className="help-desc">
                      <span style={{ color: 'var(--blue-700)', fontWeight: '600' }}>#DocumentID</span>
                      <span style={{ color: 'var(--stone-400)', margin: '0 6px' }}>•</span>
                      <span>Book/Vol/Page</span>
                      <span style={{ color: 'var(--stone-400)', margin: '0 6px' }}>•</span>
                      <span>Instrument Number</span>
                    </div>
                  </div>

                  <div className="help-section">
                    <div className="help-label">Badges</div>
                    <div className="help-desc">Color-coded document type, property type, and upload status</div>
                  </div>

                  <div className="help-section">
                    <div className="help-label">Document Details</div>
                    <div className="help-desc">
                      <div className="help-detail-row"><span className="help-field">Parties:</span> Grantor → Grantee</div>
                      <div className="help-detail-row"><span className="help-field">Filed:</span> Filing date</div>
                      <div className="help-detail-row"><span className="help-field">File Stamp:</span> File stamp date</div>
                      <div className="help-detail-row"><span className="help-field">County:</span> County name (when available)</div>
                    </div>
                  </div>

                  <div className="help-section">
                    <div className="help-label">Quick Actions</div>
                    <div className="help-desc">Click the <strong style={{ color: 'var(--ink-900)' }}>×</strong> button in the top-right corner to remove any result from the list</div>
                  </div>
                </div>
              </div>
            )}

            {/* Filter Controls */}
            {showFilters && (
              <div className="results-filters">
                <div className="filter-group">
                  <label className="filter-label">Filed Date Range:</label>
                  <input
                    type="date"
                    className="filter-input"
                    placeholder="From"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                  />
                  <span className="filter-separator">to</span>
                  <input
                    type="date"
                    className="filter-input"
                    placeholder="To"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                  />
                </div>

                <div className="filter-group">
                  <label className="filter-label">Filter by County:</label>
                  <select
                    className="filter-input"
                    value={filterCounty}
                    onChange={(e) => setFilterCounty(e.target.value)}
                  >
                    <option value="">All Counties</option>
                    {counties.map(county => (
                      <option key={county.countyID} value={county.name}>
                        {county.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="filter-group">
                  <label className="filter-label">Document Type:</label>
                  <select
                    className="filter-input"
                    value={filterDocType}
                    onChange={(e) => setFilterDocType(e.target.value)}
                  >
                    <option value="">All types</option>
                    <option value="warranty deed">Warranty deed</option>
                    <option value="deed of trust">Deed of trust</option>
                    <option value="easement">Easement</option>
                    <option value="mineral lease">Mineral lease</option>
                    <option value="mineral deed">Mineral deed</option>
                    <option value="release">Release</option>
                  </select>
                </div>

                <div className="filter-group">
                  <label className="filter-label">Sort by Type:</label>
                  <select
                    className="filter-input"
                    value={sortDocType}
                    onChange={(e) => setSortDocType(e.target.value as 'none' | 'asc' | 'desc')}
                  >
                    <option value="none">None</option>
                    <option value="asc">A → Z</option>
                    <option value="desc">Z → A</option>
                  </select>
                </div>

                {(filterDateFrom || filterDateTo || filterDocType || sortDocType !== 'none' || filterCounty) && (
                  <button
                    className="btn tiny ghost"
                    onClick={clearAllFilters}
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            )}

            {filteredResults.length === 0 && !loading && !error && (
              <div className="result-row" style={{ background: '#f3efec' }}>
                {results.length > 0 ? 'No matches for current filters.' : 'No matches.'}
              </div>
            )}

            {loading && (
              <div className="loading-container">
                <div className="loading-spinner"></div>
                <div className="loading-text">Searching…</div>
              </div>
            )}

            {filteredResults.map(row => {
              const isRemoved = removedIds.has(row.documentID);
              const isHovering = hoverRemoveId === row.documentID;

              // Debug: log first result to see what fields exist
              if (row === filteredResults[0]) {
                console.log('Sample result data:', row);
              }

              if (isRemoved) {
                return (
                  <div key={row.documentID} className="result-row removed-placeholder" onClick={() => undoRemove(row.documentID)}>
                    <div className="undo-message">Result removed. Click to undo</div>
                  </div>
                );
              }

              return (
                <div
                  key={row.documentID}
                  className={`result-row ${isHovering ? 'hover-remove' : ''}`}
                >
                  {/* X button in top right */}
                  <button
                    className="remove-x-btn"
                    onClick={() => removeFromList(row.documentID)}
                    onMouseEnter={() => setHoverRemoveId(row.documentID)}
                    onMouseLeave={() => setHoverRemoveId(null)}
                    title="Remove from results"
                  >
                    ×
                  </button>

                  {/* header */}
                  <div className="doc-head">
                    <div className="doc-title">
                      <span className="doc-id">#{row.documentID}</span>
                      <span className="doc-divider">•</span>
                      <span className="mono">{row.book ?? '—'}/{row.volume || '—'}/{row.page || '—'}</span>
                      {row.instrumentNumber && (
                        <>
                          <span className="doc-divider">•</span>
                          <span className="doc-instrument">{row.instrumentNumber}</span>
                        </>
                      )}
                    </div>

                    <div className="badges">
                      {row.instrumentType && (
                        <span className="badge" style={{
                          backgroundColor: getTypeColor(row.instrumentType).bg,
                          color: getTypeColor(row.instrumentType).text,
                          border: `1px solid ${getTypeColor(row.instrumentType).text}33`
                        }}>
                          {row.instrumentType}
                        </span>
                      )}
                      {row.propertyType && (
                        <span className="badge" style={{
                          backgroundColor: getTypeColor(row.propertyType).bg,
                          color: getTypeColor(row.propertyType).text,
                          border: `1px solid ${getTypeColor(row.propertyType).text}33`
                        }}>
                          {row.propertyType}
                        </span>
                      )}
                      {row.exportFlag ? <span className="badge" style={{ backgroundColor: '#d1fae5', color: '#065f46', border: '1px solid #06594633' }}>Uploaded</span> : null}
                    </div>
                  </div>

                  {/* meta */}
                  <div className="doc-meta">
                    <div className="kv wide">
                      <b>Parties:</b>
                      <span>
                        {fmtParty(row.grantors || row.grantor)} <span className="muted">→</span> {fmtParty(row.grantees || row.grantee)}
                      </span>
                    </div>

                    <div className="kv">
                      <b>Filed:</b> <span className="mono">{toDate(row.filingDate) ?? '—'}</span>
                    </div>

                    <div className="kv">
                      <b>File Stamp:</b> <span className="mono">{toDate(row.fileStampDate) ?? '—'}</span>
                    </div>

                    {row.countyName && (
                      <div className="kv">
                        <b>County:</b> <span>{row.countyName}</span>
                      </div>
                    )}
                  </div>

                  {/* legal preview */}

                  {/* editing and deleting stuff */}
                  {editId === row.documentID ? (
                    <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                      <div className="doc-meta">
                        <div className="kv">
                          <b>Instrument #</b>
                          <input className="input"
                            value={editValues.instrumentNumber || ''}
                            onChange={e => setEditValues((v: any) => ({ ...v, instrumentNumber: e.target.value }))} />
                        </div>

                        <div className="kv wide">
                          <b>Parties</b>
                          <input className="input"
                            placeholder="Grantor"
                            value={editValues.grantor || ''}
                            onChange={e => setEditValues((v: any) => ({ ...v, grantor: e.target.value }))} />
                          <input className="input"
                            placeholder="Grantee"
                            value={editValues.grantee || ''}
                            onChange={e => setEditValues((v: any) => ({ ...v, grantee: e.target.value }))} />
                        </div>

                        <div className="kv">
                          <b>Type</b>
                          <input className="input"
                            value={editValues.instrumentType || ''}
                            onChange={e => setEditValues((v: any) => ({ ...v, instrumentType: e.target.value }))} />
                        </div>

                        <div className="kv">
                          <b>Book</b>
                          <input className="input"
                            value={editValues.book || ''}
                            onChange={e => setEditValues((v: any) => ({ ...v, book: e.target.value }))} />
                        </div>
                        <div className="kv">
                          <b>Volume</b>
                          <input className="input"
                            value={editValues.volume || ''}
                            onChange={e => setEditValues((v: any) => ({ ...v, volume: e.target.value }))} />
                        </div>
                        <div className="kv">
                          <b>Page</b>
                          <input className="input"
                            value={editValues.page || ''}
                            onChange={e => setEditValues((v: any) => ({ ...v, page: e.target.value }))} />
                        </div>

                        <div className="kv">
                          <b>Filed</b>
                          <input className="input mono"
                            placeholder="YYYY-MM-DD"
                            value={editValues.filingDate || ''}
                            onChange={e => setEditValues((v: any) => ({ ...v, filingDate: e.target.value }))} />
                        </div>

                        <div className="kv">
                          <b>File Stamp</b>
                          <input className="input mono"
                            placeholder="YYYY-MM-DD"
                            value={editValues.fileStampDate || ''}
                            onChange={e => setEditValues((v: any) => ({ ...v, fileStampDate: e.target.value }))} />
                        </div>

                        <div className="kv">
                          <b>ExportFlag</b>
                          <input className="input"
                            placeholder="0 or 1"
                            value={editValues.exportFlag ?? 0}
                            onChange={e => setEditValues((v: any) => ({ ...v, exportFlag: Number(e.target.value) || 0 }))} />
                        </div>
                      </div>

                      <div className="legal">
                        <div className="legal-label"><b>Legal:</b></div>
                        <textarea
                          className="textarea legal-content"
                          style={{ WebkitLineClamp: 'unset', display: 'block', maxHeight: 220, overflow: 'auto' }}
                          value={editValues.legalDescription || ''}
                          onChange={e => setEditValues((v: any) => ({ ...v, legalDescription: e.target.value }))}
                        />
                      </div>

                      <div className="kv wide">
                        <b>Remarks</b>
                        <input className="input"
                          value={editValues.remarks || ''}
                          onChange={e => setEditValues((v: any) => ({ ...v, remarks: e.target.value }))} />
                      </div>

                      <div className="kv wide">
                        <b>Address</b>
                        <input className="input"
                          value={editValues.address || ''}
                          onChange={e => setEditValues((v: any) => ({ ...v, address: e.target.value }))} />
                      </div>
                    </div>
                  ) : (
                    // Your existing read-only legal preview (unchanged)
                    <div className="legal">
                      <div className="legal-label"><b>Legal:</b></div>
                      <div className="legal-content">{row.legalDescription?.trim() || '—'}</div>
                    </div>
                  )}

                  {/* ACTIONS */}
                  <div className="row-actions">
                    {editId === row.documentID ? (
                      <>
                        <button className="btn tiny" onClick={() => saveEdit(row.documentID)}>Save</button>
                        <button className="btn tiny ghost" onClick={cancelEdit}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn tiny"
                          onClick={() => previewPdf(row?.PRSERV, row?.countyName || 'Washington')}
                          title={row?.PRSERV ? `Preview ${row.PRSERV}.pdf` : "No PRSERV available"}
                          disabled={!row?.PRSERV}
                        >
                          View
                        </button>
                        <button
                          className="btn tiny"
                          onClick={() => downloadPdf(row?.PRSERV, row?.countyName || 'Washington')}
                          title={row?.PRSERV ? `Download ${row.PRSERV}.pdf` : "No PRSERV available"}
                          disabled={!row?.PRSERV}
                        >
                          Download
                        </button>

                        <button className="btn tiny" onClick={() => beginEdit(row)}>Edit</button>
                        <button className="btn tiny danger" onClick={() => deleteRow(row.documentID)}>Delete</button>
                      </>
                    )}
                  </div>


                </div>
              );
            })}
            {hasMore && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
                <button
                  className="btn"
                  onClick={() => submit(offset + 50)}
                  disabled={loading}
                  style={{ minWidth: '150px' }}
                >
                  {loading ? 'Loading…' : 'Load More'}
                </button>
              </div>
            )}
          </div>
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

function toDate(d?: string | null) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function fmtParty(s?: string | null) {
  return s && s.trim() ? s : '—';
}

function spanClass(span: number) {
  if (span === 12) return "col-12";
  if (span === 8) return "col-8";
  if (span === 6) return "col-6";
  if (span === 4) return "col-4";
  if (span === 3) return "col-3";
  return "col-12";
}