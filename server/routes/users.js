import express from 'express';
import { getPool } from '../config.js';
import { verifyAdmin } from '../middleware/verifyAdmin.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const app = express();

app.get('/users', verifyAdmin, asyncHandler(async (req, res) => {
  const pool = await getPool();
  const [users] = await pool.query(
    'SELECT userID, name, role FROM User ORDER BY userID DESC'
  );
  res.status(200).json(users);
}));

export default app;
