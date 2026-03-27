import { getPool } from '../../config.js';

/**
 * Get TIF book processing job status.
 * Returns status object or throws 404 if not found.
 */
export async function getProcessStatus(bookId) {
  if (!bookId) {
    throw Object.assign(new Error('bookId path param is required'), { status: 400 });
  }

  const pool = await getPool();
  const [rows] = await pool.execute(
    `SELECT status, pages_total, pages_processed, documents_total, documents_created,
            documents_queued_for_ai, documents_ai_processed, documents_ai_failed,
            documents_db_updated, documents_db_failed, error
     FROM TIF_Process_Job
     WHERE book_id = ?`,
    [bookId]
  );

  if (!rows || rows.length === 0) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }

  const job = rows[0];
  const total = job.documents_total ?? 0;
  const dbUpdated = job.documents_db_updated ?? 0;
  const aiFailed = job.documents_ai_failed ?? 0;
  const dbFailed = job.documents_db_failed ?? 0;

  let computedStatus = job.status;
  if (aiFailed > 0 || dbFailed > 0) {
    computedStatus = 'failed';
  } else if (total > 0 && dbUpdated >= total) {
    computedStatus = 'completed';
  } else if (job.status === 'completed') {
    computedStatus = 'processing';
  }

  if (computedStatus !== job.status) {
    await pool.execute(
      `UPDATE TIF_Process_Job
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE book_id = ?`,
      [computedStatus, bookId]
    );
  }

  const response = { status: computedStatus };

  if (job.pages_total != null) response.pagesTotal = job.pages_total;
  if (job.pages_processed != null) response.pagesProcessed = job.pages_processed;
  if (job.documents_total != null) response.documentsTotal = job.documents_total;
  if (computedStatus === 'completed' && job.documents_created !== null) {
    response.documentsCreated = job.documents_created;
  }
  if (job.documents_queued_for_ai !== null && job.documents_queued_for_ai !== undefined) {
    response.documentsQueuedForAi = job.documents_queued_for_ai;
  }
  if (job.documents_ai_processed != null) response.documentsAiProcessed = job.documents_ai_processed;
  if (job.documents_ai_failed != null) response.documentsAiFailed = job.documents_ai_failed;
  if (job.documents_db_updated != null) response.documentsDbUpdated = job.documents_db_updated;
  if (job.documents_db_failed != null) response.documentsDbFailed = job.documents_db_failed;
  if (computedStatus === 'failed' && job.error) response.error = job.error;

  return response;
}
