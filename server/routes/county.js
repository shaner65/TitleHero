import express from 'express';
const app = express();

import { getPool, getS3BucketName } from '../config.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'us-east-2' });

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
  if (!name || !name.trim()) return res.status(400).json({ message: 'County name is required' });

  const countyName = name.trim();

  try {
    const pool = await getPool();
    
    // Insert county into database
    const [result] = await pool.query('INSERT INTO County (name) VALUES (?)', [countyName]);
    const newCounty = { countyID: result.insertId, name: countyName };
    
    // Create S3 folder for the county
    try {
      const BUCKET = await getS3BucketName();
      const folderKey = `${countyName}/`; // S3 folders end with /
      
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: folderKey,
        Body: Buffer.from(''), // Empty buffer creates a folder marker
        ContentType: 'application/x-directory'
      }));
      
      console.log(`Created S3 folder for county: ${countyName}`);
    } catch (s3Error) {
      console.error('Error creating S3 folder:', s3Error);
      // Don't fail the entire operation if S3 folder creation fails
      // The folder can be created manually if needed
    }
    
    res.status(201).json(newCounty);
  } catch (error) {
    console.error(error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'County already exists' });
    }
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