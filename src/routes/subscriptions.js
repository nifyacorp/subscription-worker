const express = require('express');
const { getLogger } = require('../config/logger');

const logger = getLogger('subscription-route');
const router = express.Router();

function createSubscriptionRouter(subscriptionProcessor) {
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