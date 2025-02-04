const express = require('express');
const { getLogger } = require('../config/logger');

const logger = getLogger('subscription-route');
const router = express.Router();

function createSubscriptionRouter(subscriptionProcessor) {
  router.get('/pending-subscriptions', async (req, res) => {
    try {
      logger.debug('Fetching pending subscriptions');
      const startTime = Date.now();
      const client = await subscriptionProcessor.pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            subscription_id,
            status,
            last_run_at,
            next_run_at,
            metadata,
            error
          FROM subscription_processing
          WHERE status = 'pending'
          AND metadata->>'type' = 'boe'
          AND metadata->>'id' = 'boe-general'
          AND next_run_at <= NOW()
          LIMIT 5
        `);

        // Log the raw database response
        logger.info({
          query_time_ms: Date.now() - startTime,
          rows_returned: result.rows.length,
          raw_response: result.rows
        }, 'Database query results');
        const response = {
          count: result.rows.length,
          subscriptions: result.rows
        };


        res.status(200).json(response);
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error({ 
        error,
        errorName: error.name,
        errorCode: error.code,
        errorStack: error.stack,
        errorMessage: error.message
      }, 'Failed to fetch pending subscriptions');
      
      res.status(500).json({ 
        error: 'Failed to fetch pending subscriptions',
        details: error.message
      });
    }
  });

  router.post('/process-subscriptions', async (req, res) => {
    try {
      await subscriptionProcessor.processSubscriptions();
      res.status(200).json({ status: 'success' });
    } catch (error) {
      logger.error({ error }, 'Failed to process subscriptions');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = createSubscriptionRouter;