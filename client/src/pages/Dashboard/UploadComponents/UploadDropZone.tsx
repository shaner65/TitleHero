import React from "react";
import type { UploadDropZoneProps } from "./propTypes";

export function UploadDropZone({ inputRef, isDragging, setIsDragging, onFiles }: UploadDropZoneProps) {
  return (
    <div
      className={`dropzone ${isDragging ? "dragging" : ""}`}
      onClick={() => inputRef?.current?.click()}
      onDragOver={(e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
      }}
      onDrop={(e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onFiles(Array.from(e.target.files ?? []))
        }
      />
      {isDragging ? "Drop files here" : "Drag files here or click to upload"}
    </div>
  );
}