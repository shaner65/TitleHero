import express from 'express';
const app = express();

import { getPool } from '../config.js';

app.use(express.json());

// GET /county - list all counties
app.get('/county', async (req, res) => {
  try {
    const pool = await getPool();
    const [rows] = await pool.query('SELECT countyID, name FROM County');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching counties' });
  }
});

// GET /county/:id - get county by ID
app.get('/county/:id', async (req, res) => {
  const countyId = parseInt(req.params.id);
  if (isNaN(countyId)) return res.status(400).json({ message: 'Invalid county ID' });

  try {
    const pool = await getPool();
    const [rows] = await pool.query('SELECT countyID, name FROM County WHERE countyID = ?', [countyId]);
    if (rows.length === 0) return res.status(404).json({ message: 'County not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching county' });
  }
});

// POST /county - create new county
app.post('/county', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'County name is required' });

  try {
    const pool = await getPool();
    const [result] = await pool.query('INSERT INTO County (name) VALUES (?)', [name]);
    const newCounty = { countyID: result.insertId, name };
    res.status(201).json(newCounty);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating county' });
  }
});

// PUT /county/:id - update county by ID
app.put('/county/:id', async (req, res) => {
  const countyId = parseInt(req.params.id);
  const { name } = req.body;
  if (isNaN(countyId)) return res.status(400).json({ message: 'Invalid county ID' });
  if (!name) return res.status(400).json({ message: 'County name is required' });

  try {
    const pool = await getPool();
    const [result] = await pool.query('UPDATE County SET name = ? WHERE countyID = ?', [name, countyId]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'County not found' });

    res.json({ countyID: countyId, name });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error updating county' });
  }
});

// DELETE /county/:id - delete county by ID
app.delete('/county/:id', async (req, res) => {
  const countyId = parseInt(req.params.id);
  if (isNaN(countyId)) return res.status(400).json({ message: 'Invalid county ID' });

  try {
    const pool = await getPool();
    const [result] = await pool.query('DELETE FROM County WHERE countyID = ?', [countyId]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'County not found' });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error deleting county' });
  }
});

export default app;