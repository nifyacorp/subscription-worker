/**
 * Subscriptions API Routes
 * Handles all subscription-related operations.
 * Consolidates both process and pending subscription routes.
 */
const express = require('express');
const { getLogger } = require('../../../config/logger');
const { 
  validateSubscriptionId, 
  validateBatchRequest 
} = require('../../../middleware/validation');

const logger = getLogger('subscriptions-api');

function createSubscriptionsRouter(subscriptionProcessor) {
  const router = express.Router();

  // Track active processing to prevent duplicate requests
  const activeProcessing = new Map();

  // Constants for subscription states
  const SUBSCRIPTION_STATES = {
    PENDING: 'pending',     // Initial state, ready to be sent
    SENDING: 'sending',     // Being sent to processor
    PROCESSING: 'processing' // Processor confirmed receipt, now processing
  };
  
  /**
   * GET /api/subscriptions/pending
   * Retrieve pending subscriptions
   */
  router.get('/pending', async (req, res) => {
    try {
      const client = await subscriptionProcessor.pool.connect();
      
      try {
        // Query for pending subscriptions
        const result = await client.query(`
          SELECT 
            sp.id as processing_id,
            sp.subscription_id,
            sp.status,
            sp.next_run_at,
            sp.last_run_at,
            sp.metadata,
            sp.error,
            s.user_id,
            s.type_id,
            st.name as type_name,
            s.active,
            s.prompts,
            s.frequency,
            s.last_check_at,
            s.created_at,
            s.updated_at
          FROM subscription_processing sp
          JOIN subscriptions s ON s.id = sp.subscription_id
          JOIN subscription_types st ON st.id = s.type_id
          ORDER BY sp.next_run_at ASC
        `);
        
        const subscriptions = result.rows;
        
        logger.debug('Fetched pending subscriptions', {
          count: subscriptions.length
        });
        
        const response = {
          subscriptions,
          count: subscriptions.length
        };
        
        res.status(200).json(response);
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Failed to fetch pending subscriptions', {
        error: error.message,
        stack: error.stack
      });
      
      res.status(500).json({ 
        status: 'error',
        error: 'Failed to fetch pending subscription actions',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/subscriptions/process/:id
   * Process a subscription by ID
   */
  router.post('/process/:id', validateSubscriptionId, async (req, res) => {
    const { id } = req.params;
    
    // Check if subscription is already being processed
    if (activeProcessing.has(id)) {
      const processingData = activeProcessing.get(id);
      const now = Date.now();
      
      // If the processing started less than 5 seconds ago, return the existing request
      if (now - processingData.startTime < 5000) {
        logger.warn('Duplicate processing request for same subscription detected', {
          subscription_id: id,
          previous_request_time: new Date(processingData.startTime).toISOString(),
          time_diff_ms: now - processingData.startTime,
          path: req.path
        });
        
        return res.status(202).json({
          status: 'processing',
          message: 'Subscription is already being processed',
          processing_id: processingData.processingId,
          subscription_id: id
        });
      }
    }
    
    // Track this request
    activeProcessing.set(id, {
      startTime: Date.now(),
      path: req.path
    });
    
    logger.debug('Process subscription request received', { 
      subscription_id: id,
      path: req.path,
      method: req.method
    });

    // If the body is empty, add a warning log but continue processing
    if (!req.body || Object.keys(req.body).length === 0) {
      logger.warn('Request body is empty, using only subscription ID from URL parameters', {
        subscription_id: id
      });
      
      // Ensure req.body is at least an empty object, not null or undefined
      req.body = req.body || {};
    }
    
    // Validate the subscription ID
    if (!id || id === 'undefined' || id === 'null') {
      logger.error('Invalid subscription ID', { subscription_id: id });
      return res.status(400).json({
        status: 'error',
        error: 'Invalid subscription ID',
        message: 'A valid subscription ID is required'
      });
    }
    
    try {
      // Check if the app is running in mock database mode
      if (req.app.locals && req.app.locals.mockDatabaseMode) {
        logger.error('Cannot process subscription in mock database mode', { 
          subscription_id: id,
          mock_mode: true
        });
        return res.status(503).json({
          status: 'error',
          error: 'Database unavailable',
          message: 'The service is currently running with a mock database. Please ensure PostgreSQL is running and accessible.',
          subscription_id: id
        });
      }
      
      // Validate that we have a processor
      if (!subscriptionProcessor) {
        logger.error('No subscription processor available', { subscription_id: id });
        return res.status(500).json({
          status: 'error',
          error: 'No subscription processor available',
          message: 'The worker is not properly configured with a subscription processor'
        });
      }
      
      // Check if the subscription processor has the necessary method
      if (typeof subscriptionProcessor.processSubscription !== 'function') {
        logger.error('Subscription processor missing processSubscription method', { 
          subscription_id: id,
          processor_methods: Object.getOwnPropertyNames(Object.getPrototypeOf(subscriptionProcessor))
        });
        return res.status(500).json({
          status: 'error',
          error: 'Invalid processor configuration',
          message: 'The subscription processor is not properly configured'
        });
      }
      
      // Check if the pool is a mock pool
      if (subscriptionProcessor.pool && 
          subscriptionProcessor.pool._mockPool) {
        logger.error('Cannot process subscription with mock database pool', { 
          subscription_id: id,
          mock_pool: true
        });
        return res.status(503).json({
          status: 'error',
          error: 'Database unavailable',
          message: 'The subscription processor is using a mock database pool. Please ensure PostgreSQL is running and accessible.',
          subscription_id: id
        });
      }
      
      // Process the subscription using only the ID - the processor will fetch the subscription details
      logger.info('Processing subscription', { subscription_id: id });
      
      try {
        // First, create or update a processing record in the database to mark this subscription as queued
        const processingId = await createProcessingRecord(subscriptionProcessor.pool, id);
        
        // Store processing ID in the active processing map
        activeProcessing.set(id, {
          startTime: Date.now(),
          path: req.path,
          processingId: processingId
        });
        
        // Return response to client immediately with 202 Accepted status
        logger.info('Subscription queued for processing, returning 202 Accepted', { 
          subscription_id: id,
          processing_id: processingId
        });
        
        // Send immediate response to client
        res.status(202).json({
          status: 'success',
          message: 'Subscription queued for processing',
          processing_id: processingId,
          subscription_id: id
        });
        
        // Process the subscription asynchronously after sending the response
        setImmediate(async () => {
          try {
            // Now process the subscription
            logger.info('Starting async processing of subscription', { 
              subscription_id: id,
              processing_id: processingId
            });
            
            const result = await subscriptionProcessor.processSubscription(id);
            
            logger.info('Async processing completed successfully', {
              subscription_id: id,
              processing_id: processingId,
              result_status: result?.status || 'unknown'
            });
            
            // Remove from active processing map
            activeProcessing.delete(id);
          } catch (asyncError) {
            logger.error('Error in async subscription processing', {
              subscription_id: id,
              processing_id: processingId,
              error: asyncError.message,
              stack: asyncError.stack
            });
            
            // Update the processing record to indicate an error occurred
            try {
              await updateProcessingStatus(
                subscriptionProcessor.pool,
                processingId,
                'error',
                { error: asyncError.message }
              );
            } catch (updateError) {
              logger.error('Failed to update processing status after error', {
                subscription_id: id,
                processing_id: processingId,
                error: updateError.message
              });
            } finally {
              // Remove from active processing map even on error
              activeProcessing.delete(id);
            }
          }
        });
        
        // Since we've already sent the response, we need to return here to prevent further response attempts
        return;
      } catch (processorError) {
        logger.error('Error in subscription processor', {
          subscription_id: id,
          error: processorError.message,
          stack: processorError.stack
        });
        
        return res.status(500).json({
          status: 'error',
          error: 'Error in subscription processor',
          message: processorError.message,
          subscription_id: id
        });
      }
    } catch (error) {
      logger.error('Error processing subscription', {
        subscription_id: id,
        error: error.message,
        stack: error.stack
      });
      
      return res.status(500).json({
        status: 'error',
        error: 'Error processing subscription',
        message: error.message,
        subscription_id: id
      });
    }
  });

  /**
   * POST /api/subscriptions/batch/process
   * Process multiple subscriptions in batch
   */
  router.post('/batch/process', validateBatchRequest, async (req, res) => {
    logger.info('Batch subscription processing requested');
    
    try {
      const result = await subscriptionProcessor.processPendingSubscriptions();
      
      logger.info('Batch processing completed', {
        status: result.status,
        processed: result.processed || 0,
        success_count: result.success_count || 0,
        error_count: result.error_count || 0
      });
      
      res.status(200).json(result);
    } catch (error) {
      logger.error('Error in batch subscription processing', {
        error: error.message,
        stack: error.stack
      });
      
      res.status(500).json({
        status: 'error',
        error: 'Error in batch subscription processing',
        message: error.message
      });
    }
  });

  return router;
}

/**
 * Create a processing record in the database
 * @param {Object} pool - Database pool
 * @param {string} subscriptionId - Subscription ID
 * @returns {Promise<string>} Processing record ID
 */
async function createProcessingRecord(pool, subscriptionId) {
  if (!pool) {
    throw new Error('Database pool is required');
  }
  
  let client;
  try {
    client = await pool.connect();
    
    // Create a new processing record
    const result = await client.query(
      `INSERT INTO subscription_processing
       (subscription_id, status, metadata)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        subscriptionId,
        'pending', // Initial status
        JSON.stringify({
          queued_at: new Date().toISOString()
        })
      ]
    );
    
    if (result.rowCount === 0) {
      throw new Error('Failed to create processing record');
    }
    
    return result.rows[0].id;
  } catch (error) {
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Update a processing record's status
 * @param {Object} pool - Database pool
 * @param {string} processingId - Processing record ID
 * @param {string} status - New status
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} Updated processing record
 */
async function updateProcessingStatus(pool, processingId, status, metadata = {}) {
  if (!pool) {
    throw new Error('Database pool is required');
  }
  
  let client;
  try {
    client = await pool.connect();
    
    // Update the processing record
    const result = await client.query(
      `UPDATE subscription_processing
       SET status = $1, 
           metadata = metadata || $2::jsonb, 
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [
        status,
        JSON.stringify(metadata),
        processingId
      ]
    );
    
    if (result.rowCount === 0) {
      throw new Error(`Processing record not found: ${processingId}`);
    }
    
    return result.rows[0];
  } catch (error) {
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

module.exports = createSubscriptionsRouter;