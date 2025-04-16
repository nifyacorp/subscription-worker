/**
 * Process Service
 * Handles the logic for processing a subscription triggered by the backend scheduler.
 */
const { SubscriptionRepository } = require('../repositories');
const { sendToParser } = require('./parsers');
const logger = require('../utils/logger');
const { Pool } = require('pg');
const { createPoolConfig } = require('../config/database');

let pool;

// Initialize database connection
async function ensureDbConnection() {
  if (!pool) {
    const dbOptions = await createPoolConfig();
    pool = new Pool(dbOptions);
    
    // Test the connection
    try {
      const client = await pool.connect();
      client.release();
    } catch (error) {
      logger.error('Failed to connect to database', {
        error: error.message,
        stack: error.stack
      });
      throw new Error('Database connection failed');
    }
  }
  return pool;
}

/**
 * Process a subscription
 * @param {string} subscriptionId - The ID of the subscription to process
 * @param {string} [userId] - Optional user ID, will be fetched from the database if not provided
 * @returns {Promise<Object>} Result of the processing operation
 */
async function processSubscription(subscriptionId, userId) {
  const dbPool = await ensureDbConnection();
  const subscriptionRepository = new SubscriptionRepository(dbPool);
  
  try {
    // Update processing status to "processing"
    await updateSubscriptionProcessingStatus(subscriptionId, 'processing');
    
    // Get subscription details
    const subscription = await subscriptionRepository.getById(subscriptionId);
    
    if (!subscription) {
      await updateSubscriptionProcessingStatus(subscriptionId, 'failed', 'Subscription not found');
      throw new Error(`Subscription ${subscriptionId} not found`);
    }
    
    if (!subscription.active) {
      logger.info(`Skipping inactive subscription ${subscriptionId}`);
      await updateSubscriptionProcessingStatus(subscriptionId, 'skipped', 'Subscription is inactive');
      return { 
        success: true, 
        processed: false, 
        reason: 'Subscription is inactive' 
      };
    }
    
    // Send to appropriate parser based on subscription type
    // The parser will handle creating notifications directly
    const result = await sendToParser(subscription);
    
    // Update processing status to "completed"
    await updateSubscriptionProcessingStatus(subscriptionId, 'completed');
    
    logger.info(`Successfully processed subscription ${subscriptionId}`);
    
    return {
      success: true,
      subscriptionId,
      parserResult: result
    };
  } catch (error) {
    // Update processing status to "failed"
    await updateSubscriptionProcessingStatus(subscriptionId, 'failed', error.message);
    
    logger.error(`Error processing subscription ${subscriptionId}`, {
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
}

/**
 * Update the processing status for a subscription
 * @param {string} subscriptionId - The subscription ID
 * @param {string} status - The new status (processing, completed, failed, etc.)
 * @param {string} [errorMessage] - Optional error message for failed status
 * @returns {Promise<Object>} The updated processing record
 */
async function updateSubscriptionProcessingStatus(subscriptionId, status, errorMessage = null) {
  const dbPool = await ensureDbConnection();
  
  try {
    const query = `
      UPDATE subscription_processing
      SET 
        status = $2,
        ${status === 'completed' ? 'last_run_at = NOW(),' : ''}
        ${errorMessage ? 'error = $3,' : ''}
        updated_at = NOW()
      WHERE subscription_id = $1
      RETURNING *
    `;
    
    const params = [subscriptionId, status];
    if (errorMessage) {
      params.push(errorMessage);
    }
    
    const result = await dbPool.query(query, params);
    
    logger.info(`Updated subscription ${subscriptionId} processing status to ${status}`);
    
    return result.rows[0];
  } catch (error) {
    logger.error(`Error updating subscription processing status for ${subscriptionId}`, {
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
}

module.exports = {
  processSubscription,
  updateSubscriptionProcessingStatus
}; 