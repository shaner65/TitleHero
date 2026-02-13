import { useState, useCallback } from "react";

export type SortDocType = "none" | "asc" | "desc";

export function useResultFilters() {
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterDocType, setFilterDocType] = useState("");
  const [sortDocType, setSortDocType] = useState<SortDocType>("none");
  const [filterCounty, setFilterCounty] = useState("");

  const clearAllFilters = useCallback(() => {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterDocType("");
    setSortDocType("none");
    setFilterCounty("");
  }, []);

  return {
    filterDateFrom,
    setFilterDateFrom,
    filterDateTo,
    setFilterDateTo,
    filterDocType,
    setFilterDocType,
    sortDocType,
    setSortDocType,
    filterCounty,
    setFilterCounty,
    clearAllFilters,
  };
}
