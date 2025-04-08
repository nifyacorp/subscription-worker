const express = require('express');

const router = express.Router();

function createHealthRouter(pool) {
  // Add both /_health (original) and /health (requested in logs) endpoints
  router.get(['/_health', '/health', '/api/health', '/api/_health', '/healthz'], async (req, res) => {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        res.status(200).json({ status: 'healthy', database: 'connected' });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Health check failed', { error: error.message });
      res.status(503).json({ status: 'error', database: 'unavailable' });
    }
  });

  return router;
}

module.exports = { createHealthRouter };