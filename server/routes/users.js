import express from 'express';
import { getPool } from '../config.js';
import { verifyAdmin } from '../middleware/verifyAdmin.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { resetUserPassword, changeUserPassword } from '../auth/users.js';

const app = express();

app.get('/users', verifyAdmin, asyncHandler(async (req, res) => {
  const pool = await getPool();
  const [users] = await pool.query(
    'SELECT userID, name, role FROM User ORDER BY userID DESC'
  );
  res.status(200).json(users);
}));

// Reset user password (admin only)
app.post('/users/:id/reset-password', verifyAdmin, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  
  const pool = await getPool();
  
  // Check if user exists
  const [users] = await pool.query('SELECT userID, name FROM User WHERE userID = ?', [userId]);
  if (users.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const tempPassword = await resetUserPassword(userId);
  
  res.json({
    success: true,
    message: `Password reset for user ${users[0].name}`,
    tempPassword
  });
}));

// Change own password (any authenticated user)
app.post('/users/change-password', asyncHandler(async (req, res) => {
  const { userId, newPassword } = req.body;
  
  if (!userId || !newPassword) {
    return res.status(400).json({ error: 'userId and newPassword are required' });
  }
  
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  await changeUserPassword(userId, newPassword);
  
  res.json({ success: true, message: 'Password changed successfully' });
}));

app.get('/users/gap-report', verifyAdmin, asyncHandler(async (req, res) => {
  const pool = await getPool();
  const limit = parseInt(req.query.limit) || 1000; // Default limit to 1000 gaps
  
  // Get min and max document IDs
  const [minMaxRows] = await pool.query(
    'SELECT MIN(documentID) as minId, MAX(documentID) as maxId, COUNT(*) as totalDocs FROM Document'
  );
  
  if (!minMaxRows || minMaxRows.length === 0 || !minMaxRows[0].minId || !minMaxRows[0].maxId) {
    return res.status(200).json({ gaps: [], minId: null, maxId: null, totalGaps: 0, totalDocs: 0 });
  }
  
  const { minId, maxId, totalDocs } = minMaxRows[0];
  const totalRange = maxId - minId + 1;
  const expectedGaps = totalRange - totalDocs;
  
  // If range is too large, use SQL-based gap detection (more efficient)
  if (totalRange > 100000) {
    // Find gaps using SQL - only get the first 'limit' gaps
    const [gapRows] = await pool.query(
      `SELECT d1.documentID + 1 AS gap_id
       FROM Document d1
       WHERE NOT EXISTS (
         SELECT 1 FROM Document d2 
         WHERE d2.documentID = d1.documentID + 1
       )
       AND d1.documentID < ?
       LIMIT ?`,
      [maxId, limit]
    );
    
    const gaps = gapRows.map(row => row.gap_id);
    
    return res.status(200).json({
      gaps,
      minId,
      maxId,
      totalGaps: expectedGaps,
      totalRange,
      totalDocs,
      limited: gaps.length >= limit,
      showing: gaps.length
    });
  }
  
  // For smaller ranges, use the in-memory approach (faster for small datasets)
  const [existingRows] = await pool.query(
    'SELECT documentID FROM Document WHERE documentID BETWEEN ? AND ? ORDER BY documentID',
    [minId, maxId]
  );
  
  const existingIds = new Set(existingRows.map(row => row.documentID));
  const gaps = [];
  
  for (let id = minId; id <= maxId && gaps.length < limit; id++) {
    if (!existingIds.has(id)) {
      gaps.push(id);
    }
  }
  
  res.status(200).json({
    gaps,
    minId,
    maxId,
    totalGaps: expectedGaps,
    totalRange,
    totalDocs,
    limited: gaps.length >= limit,
    showing: gaps.length
  });
}));

export default app;
