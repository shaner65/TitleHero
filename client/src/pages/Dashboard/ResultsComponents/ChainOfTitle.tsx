import React, { useEffect, useState } from 'react';
import './ChainOfTitle.css';

interface ChainDocument {
  documentID: number;
  filingDate: string;
  instrumentType: string;
  book?: number;
  volume?: number;
  page?: number;
  grantors?: string;
  grantees?: string;
  legalDescription?: string;
  PRSERV?: string;
  countyName?: string;
}

interface ChainAnalysis {
  narrative: string;
  analysis: string;
  concerns?: string;
  source: 'ai' | 'heuristic';
}

interface ChainOfTitleProps {
  documentID: number;
}

const ChainOfTitle: React.FC<ChainOfTitleProps> = ({ documentID }) => {
  const [chain, setChain] = useState<ChainDocument[] | null>(null);
  const [analysis, setAnalysis] = useState<ChainAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    const fetchChain = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/chain-of-title/${documentID}`);
        if (!response.ok) {
          throw new Error('Failed to fetch chain of title');
        }
        const data = await response.json();
        setChain(data.chainDocs);
        setAnalysis(data.analysis);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchChain();
  }, [documentID]);

  const previewDocument = (prefix?: string | null, countyName?: string | null) => {
    if (!prefix) {
      alert('No document available to preview');
      return;
    }
    setPreviewLoading(true);
    const params = new URLSearchParams({ prefix: prefix.trim() });
    if (countyName && countyName.trim()) {
      params.append('countyName', countyName.trim());
    }
    const url = `/api/documents/pdf?${params.toString()}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => setPreviewLoading(false), 2000);
  };

  const downloadDocument = (prefix?: string | null, countyName?: string | null) => {
    if (!prefix) {
      alert('No document available to download');
      return;
    }
    setPreviewLoading(true);
    const params = new URLSearchParams({ prefix: prefix.trim(), download: 'true' });
    if (countyName && countyName.trim()) {
      params.append('countyName', countyName.trim());
    }
    const url = `/api/documents/pdf?${params.toString()}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => setPreviewLoading(false), 4000);
  };

  if (loading) {
    return <div className="chain-of-title loading">Loading chain of title...</div>;
  }

  if (error) {
    return <div className="chain-of-title error">Error: {error}</div>;
  }

  if (!chain || chain.length === 0) {
    return <div className="chain-of-title empty">No chain of title found for this document.</div>;
  }

  return (
    <div className={`chain-of-title ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="chain-header" onClick={() => setExpanded(!expanded)}>
        <h3>🔗 Chain of Title</h3>
        <span className="toggle-icon">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="chain-content">
          {analysis && (
            <div className="analysis-section">
              <div className="analysis-narrative">
                <h4>Ownership History</h4>
                <p>{analysis.narrative}</p>
              </div>
              <div className="analysis-details">
                <h4>Title Analysis</h4>
                <p>{analysis.analysis}</p>
              </div>
              {analysis.concerns && (
                <div className="analysis-concerns">
                  <h4>⚠️ Concerns</h4>
                  <p>{analysis.concerns}</p>
                </div>
              )}
              <div className="analysis-source">
                <small>
                  {analysis.source === 'ai' ? '🤖 AI-Analyzed' : '📋 Generated from Records'}
                </small>
              </div>
            </div>
          )}

          <div className="chain-timeline">
            <h4>Document Sequence</h4>
            {chain.map((doc, index) => {
              const filingDate = doc.filingDate ? new Date(doc.filingDate).toLocaleDateString() : 'Unknown';
              const bookRef = [doc.book, doc.volume, doc.page]
                .filter((v) => v)
                .join('/');
              const grantors = doc.grantors || 'Unknown';
              const grantees = doc.grantees || 'Unknown';

              return (
                <div key={doc.documentID} className="chain-item">
                  <div className="chain-item-number">{index + 1}</div>
                  <div className="chain-item-content">
                    <div className="chain-item-date">{filingDate}</div>
                    <div className="chain-item-type">{doc.instrumentType || 'Document'}</div>
                    {bookRef && <div className="chain-item-ref">Book {bookRef}</div>}
                    <div className="chain-item-transfer">
                      <strong>From:</strong> {grantors}
                    </div>
                    <div className="chain-item-transfer">
                      <strong>To:</strong> {grantees}
                    </div>
                  </div>
                  <div className="chain-item-actions">
                    <button
                      className="btn tiny icon-btn"
                      onClick={() => previewDocument(doc?.PRSERV, doc?.countyName || 'Washington')}
                      title={doc?.PRSERV ? `Preview document` : "No document available"}
                      disabled={!doc?.PRSERV || previewLoading}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/>
                        <circle cx="8" cy="8" r="2.5"/>
                      </svg>
                    </button>
                    <button
                      className="btn tiny icon-btn"
                      onClick={() => downloadDocument(doc?.PRSERV, doc?.countyName || 'Washington')}
                      title={doc?.PRSERV ? `Download document` : "No document available"}
                      disabled={!doc?.PRSERV || previewLoading}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 1v10M8 11l-3-3M8 11l3-3"/>
                        <path d="M2 11v2a2 2 0 002 2h8a2 2 0 002-2v-2"/>
                      </svg>
                    </button>
                  </div>
                  {index < chain.length - 1 && <div className="chain-connector">↓</div>}
                </div>
              );
            })}
          </div>

          <div className="chain-footer">
            <small>Total Documents: {chain.length}</small>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChainOfTitle;
