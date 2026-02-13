import type { BookProcessStatusData } from "./types";

/** Maps process-status API response to a per-file pipeline stage label (book mode). */
export function getBookPipelineStatusLabel(statusData: BookProcessStatusData): string {
  const {
    status,
    pagesTotal,
    pagesProcessed,
    documentsTotal,
    documentsQueuedForAi,
    documentsAiProcessed,
    documentsDbUpdated,
  } = statusData;

  const processed = pagesProcessed ?? 0;
  const queued = documentsQueuedForAi ?? 0;
  const aiDone = documentsAiProcessed ?? 0;
  const dbDone = documentsDbUpdated ?? 0;

  if (status === "pending") return "Uploaded";

  if (status === "processing") {
    if (pagesTotal == null) return "Starting…";
    if (processed < pagesTotal) return "Reading TIF";
    if (documentsTotal == null) return "Splitting pages";
    if (queued < documentsTotal) return "Creating documents";
    return "Sending to AI";
  }

  if (status === "completed" && documentsTotal != null) {
    if (dbDone >= documentsTotal) return "Complete";
    if (aiDone < documentsTotal) return "AI processing";
    return "Saving to DB";
  }

  return "Processing";
}

export function toStatusClass(status: string): string {
  return status.toLowerCase().replace(/[^\w]+/g, "-");
}

export function uploadFileWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

export function isTif(name: string): boolean {
  return /\.(tif|tiff)$/i.test(name);
}
