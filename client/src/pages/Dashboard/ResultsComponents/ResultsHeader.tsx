type ResultsHeaderProp = {
  loading: boolean;
  filteredResults: any[];
  showHelp: boolean;
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>;
  showFilters: boolean;
  setShowFilters: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  clearAllFilters: () => void;
}

export function ResultsHeader({loading, filteredResults, showHelp, setShowHelp, showFilters, setShowFilters, error, clearAllFilters}: ResultsHeaderProp) {

  return (
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
  )
}