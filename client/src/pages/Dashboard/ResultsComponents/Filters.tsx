type ResultFiltersProp = {
  filterDateFrom: string;
  setFilterDateFrom: React.Dispatch<React.SetStateAction<string>>;
  filterDateTo: string;
  setFilterDateTo: React.Dispatch<React.SetStateAction<string>>;
  filterCounty: string;
  setFilterCounty: React.Dispatch<React.SetStateAction<string>>;
  filterDocType: string;
  setFilterDocType: React.Dispatch<React.SetStateAction<string>>;
  sortDocType: 'none' | 'asc' | 'desc';
  setSortDocType: React.Dispatch<React.SetStateAction<'none' | 'asc' | 'desc'>>;
  counties: {
    countyID: number;
    name: string;
  }[];
  clearAllFilters: () => void;
}

export function ResultFilters({ filterDateFrom, setFilterDateFrom, filterDateTo, setFilterDateTo, filterCounty, setFilterCounty, filterDocType, setFilterDocType, sortDocType, setSortDocType, counties, clearAllFilters }: ResultFiltersProp) {
  return (
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
  )
}