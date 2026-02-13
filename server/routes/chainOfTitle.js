import express from 'express';
import { getPool } from '../config.js';
import { generateChainAnalysis, fetchChainDocsByLegalOrAddress, generateChainOfTitlePdf } from '../services/chainOfTitle/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const app = express();
app.use(express.json());

const START_DOC_QUERY = `
  SELECT d.*, c.name AS countyName,
         GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees,
         GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors
  FROM Document d
  LEFT JOIN County c ON c.countyID = d.countyID
  LEFT JOIN Party p ON p.documentID = d.documentID
  WHERE d.documentID = ?
  GROUP BY d.documentID
`;

app.get('/chain-of-title/:documentID', asyncHandler(async (req, res) => {
  const documentID = parseInt(req.params.documentID, 10);
  if (isNaN(documentID) || documentID <= 0) {
    return res.status(400).json({ error: 'Invalid documentID' });
  }

  const pool = await getPool();
  const [startDoc] = await pool.query(START_DOC_QUERY, [documentID]);

  if (!startDoc || startDoc.length === 0) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const propertyInfo = startDoc[0];
  const chainDocs = await fetchChainDocsByLegalOrAddress(pool, propertyInfo);
  const analysis = await generateChainAnalysis(chainDocs, propertyInfo);

  res.status(200).json({
    propertyInfo,
    chainDocs,
    analysis,
    documentCount: chainDocs.length
  });
}));

app.get('/chain-of-title-pdf/:documentID', asyncHandler(async (req, res) => {
  const documentID = parseInt(req.params.documentID, 10);
  if (isNaN(documentID) || documentID <= 0) {
    return res.status(400).json({ error: 'Invalid documentID' });
  }

  const pdfBuffer = await generateChainOfTitlePdf(documentID);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="chain-of-title-${documentID}.pdf"`);
  res.send(pdfBuffer);
}));

export default app;
