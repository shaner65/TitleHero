import { getPool } from '../config.js';

/**
 * Middleware to verify admin access via Bearer token and x-username header.
 * Sets req.user on success.
 */
export async function verifyAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

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
}
