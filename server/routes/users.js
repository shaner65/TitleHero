import express from 'express';
import { getPool } from '../config.js';

const app = express();

// Middleware to verify admin access
const verifyAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // The token is currently just 'dummy-token', so we need to get username from a custom header
    // or change the approach
    const username = req.headers['x-username'];
    
    if (!username) {
      return res.status(401).json({ error: 'Username header required' });
    }
    
    const pool = await getPool();
    const [users] = await pool.query(
      'SELECT userID, name, role FROM User WHERE name = ?',
      [username]
    );

    if (users.length === 0 || users[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = users[0];
    next();
  } catch (err) {
    console.error('Admin verification error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
};

// GET: all users (admin only)
app.get('/users', verifyAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const [users] = await pool.query(
      'SELECT userID, name, role FROM User ORDER BY userID DESC'
    );
    res.status(200).json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

export default app;
