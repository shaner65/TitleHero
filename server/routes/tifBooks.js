import express from 'express';
import { presignBatch, enqueueProcess, getProcessStatus } from '../services/tifBooks/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const app = express();

app.post('/tif-books/presign-batch', asyncHandler(async (req, res) => {
  const result = await presignBatch(req.body);
  res.json(result);
}));

app.post('/tif-books/:bookId/process', asyncHandler(async (req, res) => {
  const { bookId } = req.params;
  const { countyID, countyName } = req.body || {};
  const result = await enqueueProcess(bookId, countyID, countyName);
  res.status(202).json(result);
}));

app.get('/tif-books/:bookId/process-status', asyncHandler(async (req, res) => {
  const { bookId } = req.params;
  const result = await getProcessStatus(bookId);
  res.json(result);
}));

export default app;
