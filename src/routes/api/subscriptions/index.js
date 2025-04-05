/**
 * Refactored Subscriptions API Routes
 * Uses a controller to handle request logic.
 */
const express = require('express');
const { 
  validateSubscriptionId, 
  validateBatchRequest 
} = require('../../../middleware/validation'); // Assuming validation middleware is still relevant
const { getLogger } = require('../../../config/logger');

const logger = getLogger('subscriptions-router');

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

  logger.info('Registering subscription API routes');

  /**
   * GET /api/subscriptions/pending
   * Retrieve pending subscription processing records.
   */
  router.get(
    '/pending', 
    subscriptionController.getPendingSubscriptions // Delegate to controller method
  );
  logger.debug('Registered GET /pending');

  /**
   * POST /api/subscriptions/process/:id
   * Queue a specific subscription for processing.
   */
  router.post(
    '/process/:id', 
    validateSubscriptionId, // Keep validation middleware if applicable
    subscriptionController.processSingleSubscription // Delegate to controller method
  );
  logger.debug('Registered POST /process/:id');

  /**
   * POST /api/subscriptions/batch/process
   * Trigger batch processing of subscriptions.
   */
  router.post(
    '/batch/process', 
    validateBatchRequest, // Keep validation middleware if applicable
    subscriptionController.processBatchSubscriptions // Delegate to controller method
  );
   logger.debug('Registered POST /batch/process');

  // --- Remove old helper functions --- 
  // The createProcessingRecord and updateProcessingStatus functions 
  // have been moved to the ProcessTrackingRepository.
  
  logger.info('Subscription API routes registered successfully');
  return router;
}

module.exports = createSubscriptionsRouter;