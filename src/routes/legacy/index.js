/**
 * Legacy Routes
 * Provides backward compatibility with older endpoints
 */
const express = require('express');
const { getLogger } = require('../../config/logger');

const logger = getLogger('legacy-routes');

function createLegacyRouter(options) {
  const { subscriptionProcessor } = options;
  const router = express.Router();

  /**
   * Legacy endpoint for processing subscriptions
   * Redirects to the standard API endpoint
   */
  router.post('/process-subscription/:id', (req, res, next) => {
    const { id } = req.params;
    
    logger.info('Legacy endpoint called, redirecting to standard endpoint', {
      subscription_id: id,
      original_path: req.path,
      redirecting_to: `/api/subscriptions/process/${id}`
    });
    
    // Forward to the new API path
    req.url = `/api/subscriptions/process/${id}`;
    next('route');
  });

  /**
   * Handle other legacy endpoints
   * Add any other legacy routes here as needed
   */
  
  return router;
}

module.exports = createLegacyRouter;