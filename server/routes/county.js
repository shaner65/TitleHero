import express from 'express';
import * as countyService from '../services/county/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const app = express();
app.use(express.json());

app.get('/county', asyncHandler(async (req, res) => {
  const rows = await countyService.list();
  res.json(rows);
}));

app.get('/county/:id', asyncHandler(async (req, res) => {
  const countyId = parseInt(req.params.id, 10);
  if (isNaN(countyId)) {
    return res.status(400).json({ message: 'Invalid county ID' });
  }

  const county = await countyService.getById(countyId);
  if (!county) {
    return res.status(404).json({ message: 'County not found' });
  }
  res.json(county);
}));

app.post('/county', asyncHandler(async (req, res) => {
  const { name, effectiveDate } = req.body;
  const newCounty = await countyService.create(name, effectiveDate);
  res.status(201).json(newCounty);
}));

app.put('/county/:id', asyncHandler(async (req, res) => {
  const countyId = parseInt(req.params.id, 10);
  const { name, effectiveDate } = req.body;
  if (isNaN(countyId)) {
    return res.status(400).json({ message: 'Invalid county ID' });
  }

  const result = await countyService.update(countyId, name, effectiveDate);
  res.json(result);
}));

app.delete('/county/:id', asyncHandler(async (req, res) => {
  const countyId = parseInt(req.params.id, 10);
  if (isNaN(countyId)) {
    return res.status(400).json({ message: 'Invalid county ID' });
  }

  await countyService.remove(countyId);
  res.status(204).send();
}));

export default app;
