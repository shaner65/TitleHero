import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { getPool } from './config.js';

const router = express.Router();

import documentsRoutes from './routes/documents.js';
import loginRoutes from './routes/login.js';
import testRoutes from './routes/test.js';
import healthcheckRoutes from './routes/healthcheck.js';
import countyRoutes from './routes/county.js';
import usersRoutes from './routes/users.js';

const app = express();

const allowedOrigins = ['http://localhost:5173', 'http://18.219.33.27'];

const corsOptions = {
  origin: function(origin, callback) {
    // allow requests with no origin like mobile apps or curl
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-username'],
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

(async () => {
  await getPool();

  app.use(healthcheckRoutes);

  app.use('/api', router); // prefix all routes with /api

  router.use(documentsRoutes);
  router.use(loginRoutes);
  router.use(testRoutes);
  router.use(countyRoutes);
  router.use(usersRoutes);

  const port = process.env.SERVER_PORT || 5000;
  app.listen(port, () => console.log(`Server running on port ${port}`));
})();
