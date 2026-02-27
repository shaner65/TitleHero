import { useEffect, useMemo, useRef, useState } from "react";
import { FIELD_DEFS, COMMON_FIELD_IDS } from "./constants";
import type { FieldId } from "./types";

type County = { countyID: number; name: string };

function spanClass(span: number): string {
  if (span === 12) return "col-12";
  if (span === 8) return "col-8";
  if (span === 6) return "col-6";
  if (span === 4) return "col-4";
  if (span === 3) return "col-3";
  return "col-12";
}

type SearchFormProps = {
  active: FieldId[];
  setActive: React.Dispatch<React.SetStateAction<FieldId[]>>;
  values: Record<FieldId, string>;
  onChange: (id: FieldId, v: string) => void;
  counties: County[];
  onSubmit: (options?: { updatedSince?: string }) => void;
  savedSearches: { id: string; name: string }[];
  onSaveSearch: (name: string) => void;
  onLoadSearch: (id: string) => void;
  onDeleteSearch: (id: string) => void;
  loadedSearchName: string | null;
  loadedSearchLastRun: string | null;
  onClearLoadedSearch: () => void;
};

export function SearchForm({
  active,
  setActive,
  values,
  onChange,
  counties,
  onSubmit,
  savedSearches,
  onSaveSearch,
  onLoadSearch,
  onDeleteSearch,
  loadedSearchName,
  loadedSearchLastRun,
  onClearLoadedSearch,
}: SearchFormProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [dropUp, setDropUp] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [onlyNewSinceLastRun, setOnlyNewSinceLastRun] = useState(false);

  const activeSet = useMemo(() => new Set(active), [active]);

  // Initialize with common fields on mount only
  useEffect(() => {
    setActive(prev => {
      // Only add common fields if they're not already there
      if (COMMON_FIELD_IDS.every(id => prev.includes(id))) {
        return prev;
      }
      const newActive = new Set(prev);
      COMMON_FIELD_IDS.forEach(id => newActive.add(id));
      return Array.from(newActive);
    });
  }, []);

  const toggleField = (id: FieldId) => {
    setActive(prev => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter(x => x !== id) : [...prev, id];
      if (!exists) queueMicrotask(() => document.getElementById(`field-${id}`)?.focus());
      return next;
    });
  };

  const commonFieldDefs = FIELD_DEFS.filter(f => COMMON_FIELD_IDS.includes(f.id as any));

  // Close menu on outside click (excluding trigger)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (
        !menuRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  // Recalc dropdown placement when opened / resized / scrolled
  useEffect(() => {
    function recalc() {
      if (!menuOpen || !triggerRef.current) return;

      const trg = triggerRef.current.getBoundingClientRect();
      const padding = 12;
      const sidebarWidth = 200;

      const availableWidth = window.innerWidth - sidebarWidth - padding * 2;
      const desiredWidth = Math.min(900, Math.max(500, availableWidth));

      const spaceBelow = window.innerHeight - trg.bottom - padding;
      const spaceAbove = trg.top - padding;
      const minHeightNeeded = 240;

      let top = 0;
      let maxHeight = 0;
      let shouldOpenAbove = false;

      if (spaceAbove >= minHeightNeeded) {
        shouldOpenAbove = true;
        maxHeight = Math.min(window.innerHeight * 0.6, spaceAbove - 8);
        top = Math.max(padding, trg.top - maxHeight - 8);
      } else if (spaceBelow >= minHeightNeeded) {
        shouldOpenAbove = false;
        const belowMaxH = Math.min(window.innerHeight * 0.6, spaceBelow);
        maxHeight = Math.max(260, belowMaxH);
        top = trg.bottom + 8;
      } else {
        shouldOpenAbove = true;
        maxHeight = Math.min(window.innerHeight * 0.6, Math.max(spaceAbove, spaceBelow) - 8);
        top = Math.max(padding, trg.top - maxHeight - 8);
      }

      const left = Math.max(
        sidebarWidth + padding,
        Math.min(trg.left, window.innerWidth - desiredWidth - padding)
      );

      setDropUp(shouldOpenAbove);
      setMenuStyle({ top, left, maxHeight, width: desiredWidth });
    }

    recalc();
    window.addEventListener("resize", recalc);
    window.addEventListener("scroll", recalc, true);
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("scroll", recalc, true);
    };
  }, [menuOpen]);

  const renderField = (f: typeof FIELD_DEFS[number], compact = false) => (
    <div key={f.id} className={`field ${compact ? 'field-compact' : spanClass(f.span)}`} data-active>
      <label htmlFor={`field-${f.id}`}>{f.label}</label>
      {f.type === "textarea" ? (
        <textarea
          id={`field-${f.id}`}
          className="textarea"
          placeholder={f.placeholder}
          value={values[f.id] || ""}
          onChange={(e) => onChange(f.id, e.target.value)}
        />
      ) : f.type === "select" && f.id === "countyName" ? (
        <select
          id={`field-${f.id}`}
          className="input"
          value={values[f.id] || ""}
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
          value={values[f.id] || ""}
          onChange={(e) => onChange(f.id, e.target.value)}
        />
      )}
    </div>
  );

  return (
    <>
      <div className="search-title">SEARCH</div>
      
      {/* Display loaded search name */}
      {loadedSearchName && (
        <div className="loaded-search-banner">
          <span className="loaded-search-name">
            <strong>Active Search:</strong> {loadedSearchName}
          </span>
          {loadedSearchLastRun && (
            <span className="loaded-search-lastrun">
              Last run: {new Date(loadedSearchLastRun).toLocaleString()}
            </span>
          )}
          <button
            type="button"
            className="btn tiny"
            onClick={onClearLoadedSearch}
            title="Clear loaded search"
          >
            ×
          </button>
        </div>
      )}
      
      <div className="search-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            const name = window.prompt("Name this search");
            if (!name) return;
            onSaveSearch(name);
          }}
        >
          Save Search
        </button>

        <div className="saved-searches">
          <select
            className="input saved-searches__select"
            value={selectedSavedId}
            onChange={(e) => setSelectedSavedId(e.target.value)}
            aria-label="Saved searches"
          >
            <option value="">Saved searches</option>
            {savedSearches.map((search) => (
              <option key={search.id} value={search.id}>
                {search.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn tiny"
            onClick={() => selectedSavedId && onLoadSearch(selectedSavedId)}
            disabled={!selectedSavedId}
          >
            Load
          </button>

          <button
            type="button"
            className="btn tiny"
            onClick={() => {
              if (!selectedSavedId) return;
              onDeleteSearch(selectedSavedId);
              setSelectedSavedId("");
            }}
            disabled={!selectedSavedId}
          >
            Delete
          </button>
        </div>
      </div>
      <form className="search-grid" onSubmit={(e) => e.preventDefault()}>
        {/* Common fields - always visible */}
        {commonFieldDefs.map(f => {
          // Special handling for grantor/grantee pair
          if (f.id === "grantor") {
            const granteeField = FIELD_DEFS.find(fd => fd.id === "grantee");
            return (
              <div key="parties" className="col-12 parties-container">
                {renderField(f, true)}
                <div className="parties-arrow">→</div>
                {granteeField && renderField(granteeField, true)}
              </div>
            );
          }
          if (f.id === "grantee") return null; // Skip, already rendered with grantor
          
          // Special handling for volume/page pair
          if (f.id === "volume") {
            const pageField = FIELD_DEFS.find(fd => fd.id === "page");
            return (
              <div key="recording" className="col-12 recording-container">
                {renderField(f, true)}
                <div className="recording-separator">/</div>
                {pageField && renderField(pageField, true)}
              </div>
            );
          }
          if (f.id === "page") return null; // Skip, already rendered with volume
          
          return renderField(f);
        })}

        {/* Optional fields checked in the dropdown */}
        {FIELD_DEFS.filter(f => {
          // Show fields that are active but not common
          return activeSet.has(f.id) && !COMMON_FIELD_IDS.includes(f.id as any);
        }).map(f => renderField(f))}

        <div className="actions col-12">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const options: { updatedSince?: string } = {};
              if (onlyNewSinceLastRun && loadedSearchLastRun) {
                options.updatedSince = loadedSearchLastRun;
              }
              onSubmit(options);
            }}
          >
            SEARCH
          </button>
          
          {/* Only show "new since last run" option when a saved search is loaded */}
          {loadedSearchName && loadedSearchLastRun && (
            <label className="new-since-checkbox">
              <input
                type="checkbox"
                checked={onlyNewSinceLastRun}
                onChange={(e) => setOnlyNewSinceLastRun(e.target.checked)}
              />
              <span>Only new since last run</span>
            </label>
          )}

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
                <div className="dropdown-title">Advanced Options</div>

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
                    onClick={() => setActive(COMMON_FIELD_IDS as any)}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </form>
    </>
  );
}
