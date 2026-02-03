import React, { useState, useMemo } from "react";
import { API_BASE } from "../../../constants/constants";
import { ResultsHeader } from "./ResultsHeader";
import { HelpModal } from "./HelpModal";
import { ResultFilters } from "./Filters";

type ResultsProp = {
  counties: {
    countyID: number;
    name: string;
  }[];
  setPdfLoading: React.Dispatch<React.SetStateAction<boolean>>;
  results: any[];
  setResults: React.Dispatch<React.SetStateAction<any[]>>;
  loading: boolean;
  error: string | null;
  offset: number;
  hasMore: boolean;
  submit: (newOffset?: number) => Promise<void>;
  searchTerms?: Record<string, string>;
}

export function Results({counties, setPdfLoading, results, setResults, loading, error, offset, hasMore, submit, searchTerms}: ResultsProp) {
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [showFilters, setShowFilters] = useState<boolean>(false);

  // Track removed results and hover state
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [hoverRemoveId, setHoverRemoveId] = useState<number | null>(null);

  // Editing state
  const [editId, setEditId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<any>({});

  // Filter state for results
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");
  const [filterDocType, setFilterDocType] = useState<string>("");
  const [sortDocType, setSortDocType] = useState<'none' | 'asc' | 'desc'>('none');

  const [filterCounty, setFilterCounty] = useState<string>("");

  function toDate(d?: string | null) {
    if (!d) return null;
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  }

  function highlightText(text: string | null | undefined, terms?: Record<string, string>): React.ReactNode {
    if (!text || !terms) return text || '—';
    
    const termsToHighlight = Object.values(terms)
      .filter(t => t && t.trim())
      .map(t => t.trim())
      .sort((a, b) => b.length - a.length);
    
    if (termsToHighlight.length === 0) return text;
    
    const regex = new RegExp(`(${termsToHighlight.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, i) => {
      if (termsToHighlight.some(t => t.toLowerCase() === part.toLowerCase())) {
        return <mark key={i} style={{ backgroundColor: '#ffff64', padding: '0 2px' }}>{part}</mark>;
      }
      return part;
    });
  }

  const clearAllFilters = () => {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterDocType("");
    setSortDocType('none');
    setFilterCounty("");
  };

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

      {/* Help Modal */}
      {showHelp && (<HelpModal setShowHelp={setShowHelp}/>)}

      {/* Filter Controls */}
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
                  {highlightText(row.grantors || row.grantor, searchTerms)} <span className="muted">→</span> {highlightText(row.grantees || row.grantee, searchTerms)}
                </span>
              </div>

              <div className="kv">
                <b>Filed:</b> <span className="mono">{highlightText(toDate(row.filingDate) ?? '—', searchTerms)}</span>
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
                <div className="legal-content">{highlightText(row.legalDescription?.trim() || '—', searchTerms)}</div>
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
  );
}