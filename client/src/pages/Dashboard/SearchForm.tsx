import { useEffect, useMemo, useRef, useState } from "react";
import { FIELD_DEFS } from "./constants";
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
  onSubmit: () => void;
};

export function SearchForm({
  active,
  setActive,
  values,
  onChange,
  counties,
  onSubmit,
}: SearchFormProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [dropUp, setDropUp] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const activeSet = useMemo(() => new Set(active), [active]);

  const toggleField = (id: FieldId) => {
    setActive(prev => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter(x => x !== id) : [...prev, id];
      if (!exists) queueMicrotask(() => document.getElementById(`field-${id}`)?.focus());
      return next;
    });
  };

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

  return (
    <>
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

          <button type="button" className="btn btn-primary" onClick={onSubmit}>
            SEARCH
          </button>
        </div>
      </form>
    </>
  );
}
