import React, { useState, useEffect } from 'react';
import './ChainOfTitle.css';
import { API_BASE } from '../../../constants/constants';

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

  const fetchChain = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/chain-of-title/${documentID}`);
      if (!response.ok) {
        throw new Error('Failed to fetch chain of title');
      }
      const data = await response.json();
      setChain(data.chainDocs);
      setAnalysis(data.analysis);
      setExpanded(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
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
    const url = `${API_BASE}/documents/pdf?${params.toString()}`;
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
    const url = `${API_BASE}/documents/pdf?${params.toString()}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => setPreviewLoading(false), 4000);
  };

  const exportChainAsPDF = () => {
    if (!chain || chain.length === 0) {
      alert('No chain of title to export');
      return;
    }

    const url = `${API_BASE}/chain-of-title-pdf/${documentID}?type=chain`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const exportFullReport = () => {
    if (!chain || chain.length === 0) {
      alert('No chain of title to export');
      return;
    }

    const url = `${API_BASE}/chain-of-title-pdf/${documentID}?type=full`;
    window.open(url, '_blank', 'noopener,noreferrer');
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
              const isSearchedDocument = doc.documentID === documentID;

              return (
                <div key={doc.documentID} className={`chain-item ${isSearchedDocument ? 'searched' : ''}`}>
                  <div className="chain-item-number">
                    {index + 1}. <strong>{grantors} to {grantees}</strong>
                  </div>
                  <div className="chain-item-content">
                    <div className="chain-item-type"><em>{doc.instrumentType || 'Document'}</em></div>
                    <div className="chain-item-date">Dated {filingDate}</div>
                    {bookRef && <div className="chain-item-ref">Recorded in Volume {bookRef}</div>}
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
                </div>
              );
            })}
          </div>

          <div className="chain-footer">
            <small>Total Documents: {chain.length}</small>
            <div className="chain-footer-actions">
              <button 
                className="btn tiny"
                onClick={exportChainAsPDF}
                title="Export chain of title only"
              >
                Export Chain
              </button>
              <button 
                className="btn tiny"
                onClick={exportFullReport}
                title="Export full report with analysis"
              >
                Export Full Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChainOfTitle;
