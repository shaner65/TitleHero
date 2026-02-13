type PdfLoadingOverlayProps = {
  show: boolean;
};

export function PdfLoadingOverlay({ show }: PdfLoadingOverlayProps) {
  if (!show) return null;

  return (
    <div className="pdf-loading-overlay">
      <div className="pdf-loading-dialog">
        <div className="loading-spinner"></div>
        <div className="loading-text">Opening document…</div>
      </div>
    </div>
  );
}
