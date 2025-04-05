const express = require('express');
const { getLogger } = require('../config/logger');

const logger = getLogger('health-route');
const router = express.Router();

function createHealthRouter(pool) {
  // Add both /_health (original) and /health (requested in logs) endpoints
  const healthCheck = async (req, res) => {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        res.status(200).json({ status: 'healthy', database: 'connected' });
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error({ error }, 'Health check failed');
      res.status(500).json({ 
        status: 'unhealthy', 
        database: 'disconnected',
        error: error.message 
      });
    }
  };

  router.get('/_health', healthCheck);
  router.get('/health', healthCheck);

  return router;
}

module.exports = createHealthRouter;