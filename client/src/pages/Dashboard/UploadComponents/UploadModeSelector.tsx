import type { UploadMode } from "./types";

type UploadModeSelectorProps = {
  uploadMode: UploadMode;
  onModeChange: (mode: UploadMode) => void;
};

export function UploadModeSelector({ uploadMode, onModeChange }: UploadModeSelectorProps) {
  return (
    <div className="upload-mode-selector">
      <label className="upload-mode-option">
        <input
          type="radio"
          name="uploadMode"
          value="regular"
          checked={uploadMode === "regular"}
          onChange={() => onModeChange("regular")}
        />
        <div className="upload-mode-text">
          <span className="upload-mode-label">Individual documents</span>
          <span className="upload-mode-hint">One PDF or image per document. Each file becomes its own record.</span>
        </div>
      </label>
      <label className="upload-mode-option">
        <input
          type="radio"
          name="uploadMode"
          value="book"
          checked={uploadMode === "book"}
          onChange={() => onModeChange("book")}
        />
        <div className="upload-mode-text">
          <span className="upload-mode-label">Book (TIF pages)</span>
          <span className="upload-mode-hint">Multiple TIF pages from one book. AI will split pages into separate documents.</span>
        </div>
      </label>
    </div>
  );
}
