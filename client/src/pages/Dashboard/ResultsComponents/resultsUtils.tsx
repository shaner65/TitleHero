import type React from "react";

export function toDate(d?: string | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

export function highlightText(
  text: string | null | undefined,
  terms?: Record<string, string>
): React.ReactNode {
  if (!text || !terms) return text || "—";

  const termsToHighlight = Object.values(terms)
    .filter((t) => t && t.trim())
    .map((t) => t.trim())
    .sort((a, b) => b.length - a.length);

  if (termsToHighlight.length === 0) return text;

  const regex = new RegExp(
    `(${termsToHighlight.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi"
  );
  const parts = text.split(regex);

  return parts.map((part, i) => {
    if (termsToHighlight.some((t) => t.toLowerCase() === part.toLowerCase())) {
      return (
        <mark key={i} style={{ backgroundColor: "#ffff64", padding: "0 2px" }}>
          {part}
        </mark>
      );
    }
    return part;
  });
}

const DOC_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  "warranty deed": { bg: "#fcd34d", text: "#854d0e" },
  wd: { bg: "#fcd34d", text: "#854d0e" },
  swd: { bg: "#fcd34d", text: "#854d0e" },
  "special warranty deed": { bg: "#fcd34d", text: "#854d0e" },
  "general warranty deed": { bg: "#fcd34d", text: "#854d0e" },
  d: { bg: "#fcd34d", text: "#854d0e" },
  "deed of trust": { bg: "#86efac", text: "#166534" },
  dot: { bg: "#86efac", text: "#166534" },
  "trust deed": { bg: "#86efac", text: "#166534" },
  td: { bg: "#86efac", text: "#166534" },
  easement: { bg: "#93c5fd", text: "#1e3a8a" },
  esm: { bg: "#93c5fd", text: "#1e3a8a" },
  esmt: { bg: "#93c5fd", text: "#1e3a8a" },
  "mineral lease": { bg: "#93c5fd", text: "#1e3a8a" },
  "mineral leases": { bg: "#93c5fd", text: "#1e3a8a" },
  "mineral deed": { bg: "#93c5fd", text: "#1e3a8a" },
  "mineral deeds": { bg: "#93c5fd", text: "#1e3a8a" },
  release: { bg: "#e5e7eb", text: "#374151" },
  rel: { bg: "#e5e7eb", text: "#374151" },
  rln: { bg: "#e5e7eb", text: "#374151" },
  discharge: { bg: "#e5e7eb", text: "#374151" },
};

const DEFAULT_TYPE_COLOR = { bg: "#e8eef9", text: "#2c4771" };

export function getTypeColor(
  type: string | null | undefined
): { bg: string; text: string } {
  if (!type) return DEFAULT_TYPE_COLOR;
  const normalized = String(type).toLowerCase().trim();
  return DOC_TYPE_COLORS[normalized] ?? DEFAULT_TYPE_COLOR;
}
