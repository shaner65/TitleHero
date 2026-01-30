type HelpModalProp = {
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>;
}

export function HelpModal({setShowHelp}: HelpModalProp) {
  return (
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
  )
}