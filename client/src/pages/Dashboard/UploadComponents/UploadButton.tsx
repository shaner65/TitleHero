type UploadButtonProps = {
  setShowUpload: React.Dispatch<React.SetStateAction<boolean>>;
}

export function UploadButton({setShowUpload}: UploadButtonProps) {
  return (
    <button
      className="upload-btn"
      onClick={() => setShowUpload(true)}
      aria-label="Upload"
      title="Upload"
    >
      ↑
    </button>
  )
}