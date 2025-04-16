/**
 * Refactored Subscriptions API Routes
 * Uses a controller to handle request logic.
 */
const express = require('express');
const { 
  validateSubscriptionId, 
  validateBatchRequest 
} = require('../../../middleware/validation'); // Assuming validation middleware is still relevant

/**
 * Creates the Express router for subscription API endpoints.
 * @param {SubscriptionController} subscriptionController - The controller handling subscription logic.
 * @returns {express.Router} The configured Express router.
 */
function createSubscriptionsRouter(subscriptionController) {
  if (!subscriptionController) {
    throw new Error('createSubscriptionsRouter requires a SubscriptionController instance.');
  }
  const router = express.Router();

  console.info('Registering subscription API routes');

  /**
   * GET /api/subscriptions/pending
   * Retrieve pending subscription processing records.
   */
  router.get(
    '/pending', 
    subscriptionController.getPendingSubscriptions // Delegate to controller method
  );
  console.debug('Registered GET /pending');

  /**
   * POST /api/subscriptions/process/:id
   * Queue a specific subscription for processing.
   * This is the primary and preferred endpoint for subscription processing.
   */
  router.post(
    '/process/:id', 
    validateSubscriptionId, // Keep validation middleware if applicable
    subscriptionController.processSingleSubscription // Delegate to controller method
  );
  console.debug('Registered POST /process/:id');

  /**
   * POST /api/subscriptions/batch/process
   * Trigger batch processing of subscriptions.
   */
  router.post(
    '/batch/process', 
    validateBatchRequest, // Keep validation middleware if applicable
    subscriptionController.processBatchSubscriptions // Delegate to controller method
  );
  console.debug('Registered POST /batch/process');
  
  /**
   * POST /api/subscriptions/process-all
   * Process all pending subscriptions.
   * This endpoint is designed to be called by a Cloud Scheduler job.
   */
  router.post(
    '/process-all',
    subscriptionController.processBatchSubscriptions // Reuse the batch processing method
  );
  console.debug('Registered POST /process-all');
  
  console.info('Subscription API routes registered successfully');
  return router;
}

module.exports = createSubscriptionsRouter;