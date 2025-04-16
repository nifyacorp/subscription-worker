/**
 * Process API Routes
 * Handles requests for processing a subscription from the backend scheduler.
 */
const express = require('express');
const { processSubscription } = require('../services/process');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Process a subscription
 * @route POST /process
 * @param {string} subscriptionId - UUID of the subscription to process
 * @param {string} userId - ID of the user who owns the subscription
 */
router.post('/process', async (req, res) => {
  try {
    const { subscriptionId, userId } = req.body;
    
    if (!subscriptionId) {
      logger.warn('Missing required parameter: subscriptionId');
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameter: subscriptionId' 
      });
    }
    
    logger.info(`Processing subscription ${subscriptionId}`, { userId });
    
    const result = await processSubscription(subscriptionId, userId);
    
    return res.json({
      success: true,
      message: 'Subscription processing triggered successfully',
      data: result
    });
  } catch (error) {
    logger.error('Error processing subscription', {
      error: error.message,
      stack: error.stack,
      subscriptionId: req.body.subscriptionId
    });
    
    return res.status(500).json({
      success: false,
      message: 'Failed to process subscription',
      error: error.message
    });
  }
});

module.exports = router; 