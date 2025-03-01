const { getLogger } = require('../../config/logger'); 
const logger = getLogger('subscription-process');

const SUBSCRIPTION_STATES = {
  PENDING: 'pending',     // Initial state, ready to be sent
  SENDING: 'sending',     // Being sent to processor
  PROCESSING: 'processing' // Processor confirmed receipt, now processing
};

/**
 * Process a subscription asynchronously
 */
async function processSubscriptionAsync(subscription, { pool, boeController }) {
  const logger = getLogger('subscription-process-async');
  
  // Log detailed information about what we received
  logger.debug('Processing subscription asynchronously', {
    subscription_id: subscription?.subscription_id || 'unknown',
    subscription_data: subscription ? JSON.stringify(subscription).substring(0, 200) + '...' : 'null',
    boe_controller_available: !!boeController,
    controller_type: boeController ? boeController.constructor.name : 'undefined',
    has_process_method: boeController && typeof boeController.processSubscription === 'function'
  });
  
  // Validate inputs
  if (!subscription) {
    logger.error('No subscription data provided');
    throw new Error('No subscription data provided');
  }
  
  if (!boeController || typeof boeController.processSubscription !== 'function') {
    logger.error('No valid processor provided', {
      subscription_id: subscription.subscription_id,
      controller_type: boeController ? boeController.constructor.name : 'null',
      controller_methods: boeController ? Object.getOwnPropertyNames(Object.getPrototypeOf(boeController)) : []
    });
    throw new Error('No valid processor provided');
  }
  
  const { subscription_id, processing_id } = subscription;
  
  if (!subscription_id) {
    logger.error('No subscription ID in data');
    throw new Error('No subscription ID in data');
  }
  
  // Start a client transaction for database operations
  let client;
  try {
    client = await pool.connect();
    
    // Begin transaction
    await client.query('BEGIN');
    
    // Get the subscription details to ensure it exists and is valid
    const subscriptionResult = await client.query(
      `SELECT * FROM subscriptions WHERE id = $1`,
      [subscription_id]
    );
    
    if (subscriptionResult.rowCount === 0) {
      throw new Error(`Subscription not found with ID: ${subscription_id}`);
    }
    
    const subscriptionData = subscriptionResult.rows[0];
    logger.debug('Retrieved subscription data', {
      subscription_id,
      user_id: subscriptionData.user_id,
      is_active: subscriptionData.is_active
    });
    
    // Check if there's already an active processing
    const activeProcessingResult = await client.query(
      `SELECT id, status FROM subscription_processing
       WHERE subscription_id = $1 AND status IN ('sending', 'processing')
       ORDER BY created_at DESC
       LIMIT 1`,
      [subscription_id]
    );
    
    if (activeProcessingResult.rowCount > 0 && processing_id !== activeProcessingResult.rows[0].id) {
      const activeProcessing = activeProcessingResult.rows[0];
      logger.warn('Another processing is already active for this subscription', {
        subscription_id,
        active_processing_id: activeProcessing.id,
        active_status: activeProcessing.status,
        current_processing_id: processing_id
      });
    }
    
    // Update the processing status to SENDING
    logger.debug('Updating processing status to SENDING', {
      subscription_id,
      processing_id
    });
    
    try {
      const updateResult = await client.query(
        `UPDATE subscription_processing
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, status`,
        [SUBSCRIPTION_STATES.SENDING, processing_id]
      );
      
      if (updateResult.rowCount === 0) {
        throw new Error(`Processing record not found with ID: ${processing_id}`);
      }
      
      const updatedProcessing = updateResult.rows[0];
      if (updatedProcessing.status !== SUBSCRIPTION_STATES.SENDING) {
        logger.warn('Processing status not updated as expected', {
          subscription_id,
          processing_id,
          expected_status: SUBSCRIPTION_STATES.SENDING,
          actual_status: updatedProcessing.status
        });
      }
    } catch (updateError) {
      // Handle constraint violation errors separately
      if (updateError.code === '23514') { // Check constraint violation
        logger.warn('Constraint violation when updating processing status', {
          subscription_id,
          processing_id,
          error_code: updateError.code,
          error_message: updateError.message
        });
        
        // Create a new processing record instead
        logger.info('Creating new processing record due to constraint violation', {
          subscription_id
        });
        
        const insertResult = await client.query(
          `INSERT INTO subscription_processing
           (subscription_id, status, metadata)
           VALUES ($1, $2, $3)
           RETURNING id, status`,
          [
            subscription_id,
            SUBSCRIPTION_STATES.SENDING,
            JSON.stringify(subscriptionData.metadata || {})
          ]
        );
        
        if (insertResult.rowCount === 0) {
          throw new Error('Failed to create new processing record');
        }
        
        const newProcessing = insertResult.rows[0];
        logger.info('Created new processing record', {
          subscription_id,
          new_processing_id: newProcessing.id,
          status: newProcessing.status
        });
      } else {
        // Re-throw other errors
        throw updateError;
      }
    }
    
    // Commit the transaction
    await client.query('COMMIT');
    
    // Prepare the data for the processor
    const processorData = {
      subscription_id,
      user_id: subscriptionData.user_id,
      metadata: subscriptionData.metadata,
      prompts: subscriptionData.prompts
    };
    
    // Log what we're sending to the processor
    logger.debug('Sending data to processor', {
      subscription_id,
      data_preview: JSON.stringify(processorData).substring(0, 200) + '...',
      processor_type: boeController.constructor.name
    });
    
    // Process the subscription with the BOE controller
    try {
      const result = await boeController.processSubscription(processorData);
      
      logger.info('Processor completed successfully', {
        subscription_id,
        result_status: result?.status || 'unknown',
        entries_count: result?.entries?.length || 0,
        matches_count: result?.matches?.length || 0,
        result_summary: JSON.stringify(result).substring(0, 200) + '...'
      });
      
      // Update the processing status to COMPLETED
      await updateProcessingStatus(pool, processing_id, SUBSCRIPTION_STATES.PROCESSING, result);
      
      return result;
    } catch (processorError) {
      logger.error('Error in processor', {
        subscription_id,
        error: processorError.message,
        stack: processorError.stack
      });
      
      // Update the processing status to ERROR
      await updateProcessingStatus(
        pool,
        processing_id,
        SUBSCRIPTION_STATES.PROCESSING,
        { error: processorError.message }
      );
      
      throw processorError;
    }
  } catch (error) {
    logger.error('Error in processSubscriptionAsync', {
      subscription_id: subscription?.subscription_id,
      error: error.message,
      stack: error.stack
    });
    
    // If we have a client and transaction is in progress, roll it back
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Error rolling back transaction', {
          error: rollbackError.message
        });
      }
    }
    
    throw error;
  } finally {
    // Release the client back to the pool
    if (client) {
      try {
        client.release();
      } catch (releaseError) {
        logger.error('Error releasing client', {
          error: releaseError.message
        });
      }
    }
  }
}

function createProcessRouter(subscriptionProcessor) {
  const router = require('express').Router();

  // Endpoint to process a single subscription by ID
  router.post('/process-subscription/:id', async (req, res) => {
    const { id } = req.params;
    logger.debug('Process subscription request received', { 
      subscription_id: id,
      body: req.body,
      body_size: req.body ? JSON.stringify(req.body).length : 0,
      body_type: typeof req.body,
      body_content: JSON.stringify(req.body).substring(0, 100),
      body_null: req.body === null,
      body_undefined: req.body === undefined,
      headers: req.headers,
      content_type: req.headers['content-type'],
      content_length: req.headers['content-length'],
      method: req.method,
      path: req.path,
      phase: 'request_received'
    });

    // If the body is empty, add a warning log but continue processing
    if (!req.body || Object.keys(req.body).length === 0) {
      logger.warn('Request body is empty, using only subscription ID from URL parameters', {
        subscription_id: id,
        body_empty: true,
        headers: req.headers,
        content_type: req.headers['content-type'],
        content_length: req.headers['content-length'],
        phase: 'empty_request_body'
      });
      
      // Ensure req.body is at least an empty object, not null or undefined
      req.body = req.body || {};
    }
    
    // Validate the subscription ID
    if (!id || id === 'undefined' || id === 'null') {
      logger.error('Invalid subscription ID', { subscription_id: id });
      return res.status(400).json({
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
          error: 'Invalid processor configuration',
          message: 'The subscription processor is not properly configured'
        });
      }
      
      // Check if the pool is a mock pool
      if (subscriptionProcessor.pool && 
          subscriptionProcessor.pool.connect && 
          subscriptionProcessor.pool.connect.toString().includes('Mock database')) {
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
        error: 'Error processing subscription',
        message: error.message,
        subscription_id: id
      });
    }
  });

  // Bulk processing endpoint for multiple subscriptions
  router.post('/process-subscriptions', async (req, res) => {
    logger.debug('Process multiple subscriptions request received', {
      body_present: !!req.body,
      subscriptions_count: req.body?.subscriptions?.length || 0,
      headers: req.headers,
      method: req.method,
      path: req.path
    });
    
    // Validate request
    if (!req.body || !req.body.subscriptions || !Array.isArray(req.body.subscriptions)) {
      logger.warn('Invalid request format for bulk processing', {
        body_type: typeof req.body,
        body_keys: req.body ? Object.keys(req.body) : []
      });
      
      return res.status(400).json({
        error: 'Invalid request format',
        message: 'Request must include a "subscriptions" array'
      });
    }
    
    const { subscriptions } = req.body;
    
    if (subscriptions.length === 0) {
      logger.warn('Empty subscriptions array in request');
      return res.status(400).json({
        error: 'No subscriptions provided',
        message: 'The subscriptions array is empty'
      });
    }
    
    try {
      // Process each subscription and collect results
      const results = [];
      const errors = [];
      
      logger.info('Processing multiple subscriptions', { count: subscriptions.length });
      
      for (const subscription of subscriptions) {
        try {
          if (!subscription.id) {
            errors.push({
              subscription: subscription,
              error: 'Missing subscription ID'
            });
            continue;
          }
          
          // Process this subscription
          const result = await subscriptionProcessor.processSubscription(subscription.id);
          results.push({
            subscription_id: subscription.id,
            status: 'queued',
            processing_id: result.processing_id
          });
        } catch (subError) {
          logger.error('Error processing subscription in bulk', {
            subscription_id: subscription.id,
            error: subError.message
          });
          
          errors.push({
            subscription_id: subscription.id,
            error: subError.message
          });
        }
      }
      
      // Return response with results and any errors
      logger.info('Bulk processing completed', {
        success_count: results.length,
        error_count: errors.length
      });
      
      return res.status(202).json({
        status: 'success',
        message: `Processed ${results.length} subscriptions with ${errors.length} errors`,
        results,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      logger.error('Critical error in bulk processing', {
        error: error.message,
        stack: error.stack
      });
      
      return res.status(500).json({
        error: 'Error processing subscriptions',
        message: error.message
      });
    }
  });

  /**
   * Process a subscription - API handler
   */
  router.post('/:id', async (req, res) => {
    const { id } = req.params;
    const logger = getLogger('subscription-process-endpoint');
    
    logger.info('Received subscription processing request', {
      subscription_id: id,
      request_body_size: req.body ? JSON.stringify(req.body).length : 0,
      content_type: req.get('Content-Type'),
      content_length: req.get('Content-Length')
    });
    
    // Log the request body for debugging
    if (req.body) {
      logger.debug('Request body', {
        body: JSON.stringify(req.body),
        body_keys: Object.keys(req.body),
        empty_body: Object.keys(req.body).length === 0
      });
    } else {
      logger.warn('Request body is empty', {
        subscription_id: id,
        content_type: req.get('Content-Type')
      });
    }
    
    // Validate the subscription ID
    if (!id || id === 'undefined') {
      logger.error('Invalid subscription ID', { id });
      return res.status(400).json({
        error: 'Invalid subscription ID',
        status: 'error'
      });
    }
    
    try {
      // Process the subscription
      const result = await subscriptionProcessor.processSubscription(id);
      
      logger.info('Subscription processing initiated successfully', {
        subscription_id: id,
        result: JSON.stringify(result)
      });
      
      return res.json(result);
    } catch (error) {
      logger.error('Error processing subscription', {
        subscription_id: id,
        error: error.message,
        stack: error.stack
      });
      
      return res.status(500).json({
        error: error.message,
        status: 'error'
      });
    }
  });

  return router;
}

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

module.exports = createProcessRouter;