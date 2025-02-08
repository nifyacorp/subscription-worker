const express = require('express');
const { getLogger } = require('../config/logger');

const logger = getLogger('subscription-route');
const router = express.Router();

function createSubscriptionRouter(subscriptionProcessor) {
  router.get('/pending-subscriptions', async (req, res) => {
    try {
      logger.debug('Fetching pending subscriptions');
      const client = await subscriptionProcessor.pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            sp.subscription_id,
            sp.metadata->>'action' as action,
            sp.metadata->>'parameters' as parameters,
            sp.last_run_at
          FROM subscription_processing
          WHERE status = 'pending'
          AND metadata->>'type' = 'boe'
          AND metadata->>'id' = 'boe-general'
          AND metadata->>'action' IS NOT NULL
          AND next_run_at <= NOW()
          LIMIT 5
        `);

        // Transform the results to focus on actions
        const actions = result.rows.map(row => ({
          subscription_id: row.subscription_id,
          action: row.action,
          parameters: JSON.parse(row.parameters || '{}'),
          last_executed: row.last_run_at
        }));

        const response = {
          pending_actions: actions
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
        errorMessage: error.message
      }, 'Failed to fetch pending subscriptions');
      
      res.status(500).json({ 
        error: 'Failed to fetch pending subscription actions'
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