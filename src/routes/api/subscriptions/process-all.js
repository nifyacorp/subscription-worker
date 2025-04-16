/**
 * Process All Subscriptions API Route
 * This endpoint processes all pending subscriptions at once.
 * It's designed to be called by a scheduled Cloud Scheduler job.
 */
const express = require('express');
const logger = require('../../../utils/logger');

/**
 * Creates the Express router for processing all subscriptions.
 * @param {SubscriptionController} subscriptionController - The controller handling subscription logic.
 * @returns {express.Router} The configured Express router.
 */
function createProcessAllRouter(subscriptionController) {
  if (!subscriptionController) {
    throw new Error('createProcessAllRouter requires a SubscriptionController instance.');
  }
  
  const router = express.Router();

  /**
   * POST /api/subscriptions/process-all
   * Process all pending subscriptions.
   * This is designed to be triggered by Cloud Scheduler.
   */
  router.post('/process-all', async (req, res) => {
    const traceId = req.headers['x-trace-id'] || `trace-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    
    logger.info('Received request to process all pending subscriptions', { 
      trace_id: traceId,
      request_source: req.headers['user-agent'] || 'unknown'
    });
    
    try {
      // Delegate to the service layer to process all pending subscriptions
      const result = await subscriptionController.processBatchSubscriptions(req, res, (error) => {
        // This is our custom error handler to maintain consistent logging
        logger.error('Error processing all subscriptions', {
          error: error.message,
          stack: error.stack,
          trace_id: traceId
        });
        
        res.status(500).json({
          status: 'error',
          message: 'Failed to process all subscriptions',
          error: error.message,
          trace_id: traceId
        });
      });
      
      // Note: Response is handled within processBatchSubscriptions
    } catch (error) {
      logger.error('Unhandled error in process-all endpoint', {
        error: error.message,
        stack: error.stack,
        trace_id: traceId
      });
      
      res.status(500).json({
        status: 'error',
        message: 'Failed to process all subscriptions',
        error: error.message,
        trace_id: traceId
      });
    }
  });

  logger.info('Process All Subscriptions route registered');
  return router;
}

module.exports = createProcessAllRouter; 