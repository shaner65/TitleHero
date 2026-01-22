require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getPool } = require('./config');

const router = express.Router();

const documentsRoutes = require('./routes/documents');
const loginRoutes = require('./routes/login');
const testRoutes = require('./routes/test');
const healthcheckRoutes = require('./routes/healthcheck');
const countyRoutes = require('./routes/county')

const app = express();

const allowedOrigins = ['http://localhost:5173', 'http://18.219.33.27'];

app.use(cors({
  origin: function(origin, callback) {
    // allow requests with no origin like mobile apps or curl
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
}));

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

  const port = process.env.SERVER_PORT || 5000;
  app.listen(port, () => console.log(`Server running on port ${port}`));
})();
