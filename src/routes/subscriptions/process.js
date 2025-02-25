const { getLogger } = require('../../config/logger'); 
const logger = getLogger('subscription-process');

const SUBSCRIPTION_STATES = {
  PENDING: 'pending',     // Initial state, ready to be sent
  SENDING: 'sending',     // Being sent to processor
  PROCESSING: 'processing' // Processor confirmed receipt, now processing
};

async function processSubscriptionAsync(subscription, subscriptionProcessor) {
  const logger = getLogger("subscription-process");
  let client = null;
  
  try {
    // Log subscription data for debugging
    logger.debug("Starting subscription processing", {
      subscription_id: subscription.subscription_id,
      subscription_data: JSON.stringify(subscription),
      processor_type: subscriptionProcessor ? typeof subscriptionProcessor : 'undefined',
      processor_methods: subscriptionProcessor ? Object.getOwnPropertyNames(Object.getPrototypeOf(subscriptionProcessor)) : []
    });

    if (!subscription) {
      logger.error("No subscription data provided");
      throw new Error("No subscription data provided");
    }

    if (!subscriptionProcessor) {
      logger.error("No processor available for subscription", { 
        subscription_id: subscription.subscription_id,
        subscription_type: subscription.metadata?.type || 'unknown'
      });
      throw new Error(`No processor available for subscription ${subscription.subscription_id}`);
    }
    
    logger.debug("Connecting to database");
    client = await subscriptionProcessor.pool.connect();
    logger.debug("Database connection established");
    
    // Get full subscription data
    logger.debug("Querying subscription details", { 
      subscription_id: subscription.subscription_id,
      query: "SELECT subscription details" 
    });
    
    const result = await client.query(
      `SELECT 
        p.id as processing_id,
        p.subscription_id,
        p.created_at,
        p.updated_at,
        p.status,
        p.result,
        p.metadata,
        s.created_at as subscription_created_at,
        s.updated_at as subscription_updated_at,
        s.user_id,
        s.type_id,
        s.prompts,
        s.frequency,
        s.last_check_at
      FROM subscription_processings p
      JOIN subscriptions s ON p.subscription_id = s.id
      WHERE p.subscription_id = $1
      ORDER BY p.created_at DESC
      LIMIT 1`,
      [subscription.subscription_id]
    );
    
    logger.debug("Query result received", { 
      subscription_id: subscription.subscription_id,
      rows_found: result.rowCount
    });
    
    if (result.rowCount === 0) {
      throw new Error(`No subscription found with id ${subscription.subscription_id}`);
    }
    
    const subscriptionData = result.rows[0];
    logger.debug("Subscription details retrieved", { subscription: subscriptionData });
    
    // Begin transaction for updating status
    await client.query("BEGIN");
    
    // Validate subscription status before updating
    // First check if there's any active processing for this subscription
    const activeProcessingCheck = await client.query(
      `SELECT status FROM subscription_processings 
       WHERE subscription_id = $1 AND status IN ('pending', 'processing', 'sending')
       AND id != $2
       LIMIT 1`,
      [subscription.subscription_id, subscriptionData.processing_id]
    );
    
    if (activeProcessingCheck.rowCount > 0) {
      logger.warn("Another processing is already active for this subscription", {
        subscription_id: subscription.subscription_id,
        current_processing_id: subscriptionData.processing_id,
        existing_status: activeProcessingCheck.rows[0].status
      });
      
      // Still proceed, but with a warning
    }
    
    // Update status to SENDING
    logger.debug("Updating subscription processing status to SENDING", {
      processing_id: subscriptionData.processing_id,
      status: "sending"
    });
    
    try {
      await client.query(
        `UPDATE subscription_processings 
         SET status = 'sending', updated_at = NOW()
         WHERE id = $1 AND status = 'pending'`,
        [subscriptionData.processing_id]
      );
      
      // Verify the update was successful
      const statusUpdateCheck = await client.query(
        `SELECT status FROM subscription_processings WHERE id = $1`,
        [subscriptionData.processing_id]
      );
      
      if (statusUpdateCheck.rowCount === 0 || statusUpdateCheck.rows[0].status !== 'sending') {
        logger.warn("Status update did not complete as expected", {
          processing_id: subscriptionData.processing_id,
          expected_status: 'sending',
          actual_status: statusUpdateCheck.rowCount > 0 ? statusUpdateCheck.rows[0].status : 'unknown'
        });
      } else {
        logger.debug("Status updated successfully", {
          processing_id: subscriptionData.processing_id,
          status: 'sending'
        });
      }
    } catch (updateError) {
      logger.error("Error updating subscription status", {
        processing_id: subscriptionData.processing_id,
        phase: "update_status",
        error: updateError,
        error_message: updateError.message,
        error_code: updateError.code
      });
      
      // If this is a constraint violation, attempt an alternative approach
      if (updateError.code === '23514') {
        logger.warn("Constraint violation detected. Attempting alternative update approach", {
          processing_id: subscriptionData.processing_id
        });
        
        // Create a new processing record instead of updating the existing one
        await client.query(
          `INSERT INTO subscription_processings
           (subscription_id, status, metadata)
           VALUES ($1, 'sending', $2)`,
          [subscription.subscription_id, JSON.stringify(subscriptionData.metadata)]
        );
        
        const newProcessingResult = await client.query(
          `SELECT id FROM subscription_processings 
           WHERE subscription_id = $1 
           ORDER BY created_at DESC LIMIT 1`,
          [subscription.subscription_id]
        );
        
        if (newProcessingResult.rowCount > 0) {
          subscriptionData.processing_id = newProcessingResult.rows[0].id;
          logger.info("Created new processing record instead of updating", {
            subscription_id: subscription.subscription_id,
            new_processing_id: subscriptionData.processing_id
          });
        } else {
          throw new Error("Failed to create alternative processing record");
        }
      } else {
        // For other errors, rethrow
        throw updateError;
      }
    }
    
    await client.query("COMMIT");
    
    // Determine the processor type from metadata
    const processorType = subscriptionData.metadata?.type || "unknown";
    logger.debug(`Using ${processorType} processor for subscription`, {
      subscription_id: subscription.subscription_id,
      processor_type: processorType,
      processor_available: !!subscriptionProcessor
    });
    
    // Process subscription with the appropriate processor
    try {
      // Check if processor has the processSubscription method
      if (!subscriptionProcessor.processSubscription) {
        logger.warn(`Processor doesn't have processSubscription method`, {
          processor_type: processorType,
          processor_methods: Object.getOwnPropertyNames(Object.getPrototypeOf(subscriptionProcessor))
        });
        throw new Error(`Processor ${processorType} doesn't have processSubscription method`);
      }
      
      // Call the processor's processSubscription method
      logger.debug("Calling processor processSubscription method", {
        subscription_id: subscription.subscription_id,
        processor_type: processorType,
        prompts: subscriptionData.prompts
      });
      
      const processingResult = await subscriptionProcessor.processSubscription(subscriptionData);
      
      // Re-connect to database for updates
      if (!client || client.release) {
        logger.debug("Reconnecting to database for status update");
        client = await subscriptionProcessor.pool.connect();
      }
      
      // Update processing status to completed
      await client.query("BEGIN");
      logger.debug("Updating processing status to completed", {
        processing_id: subscriptionData.processing_id,
        result_summary: processingResult ? "success" : "no result"
      });
      
      await client.query(
        `UPDATE subscription_processings
         SET status = 'completed', result = $1, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(processingResult || {}), subscriptionData.processing_id]
      );
      
      // Update the subscription's last_check_at
      await client.query(
        `UPDATE subscriptions
         SET last_check_at = NOW()
         WHERE id = $1`,
        [subscription.subscription_id]
      );
      
      await client.query("COMMIT");
      logger.debug("Processing completed successfully", {
        subscription_id: subscription.subscription_id
      });
      
      return {
        status: "success",
        message: "Subscription processed successfully",
        result: processingResult
      };
    } catch (processingError) {
      logger.error("Error during subscription processing", {
        subscription_id: subscription.subscription_id,
        processing_id: subscriptionData.processing_id,
        error: processingError,
        phase: "processing"
      });
      
      // Re-connect to database for updates if needed
      if (!client || client.release) {
        client = await subscriptionProcessor.pool.connect();
      }
      
      // Update processing status to error
      await client.query("BEGIN");
      logger.debug("Updating processing status to error", {
        processing_id: subscriptionData.processing_id,
        error_message: processingError.message
      });
      
      await client.query(
        `UPDATE subscription_processings
         SET status = 'error', 
             result = $1, 
             updated_at = NOW()
         WHERE id = $2`,
        [
          JSON.stringify({
            error: processingError.message,
            stack: processingError.stack,
            timestamp: new Date().toISOString()
          }),
          subscriptionData.processing_id
        ]
      );
      
      await client.query("COMMIT");
      throw processingError;
    }
  } catch (error) {
    logger.error("Error in subscription processing", {
      error: error.message,
      stack: error.stack,
      subscription_id: subscription?.subscription_id || "unknown"
    });
    
    if (client) {
      // Rollback any pending transaction
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        logger.error("Error during transaction rollback", {
          error: rollbackError.message
        });
      }
    }
    
    throw error;
  } finally {
    // Release database client
    if (client) {
      logger.debug("Releasing database client");
      client.release();
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
      body_json: JSON.stringify(req.body),
      body_type: typeof req.body,
      body_length: req.body ? Object.keys(req.body).length : 0,
      headers: req.headers,
      method: req.method,
      path: req.path,
      phase: 'request_received'
    });

    // If the body is empty, add a warning log
    if (!req.body || Object.keys(req.body).length === 0) {
      logger.warn('Request body is empty, this might cause problems with some processors', {
        subscription_id: id,
        body_empty: true,
        headers: req.headers,
        content_type: req.headers['content-type'],
        content_length: req.headers['content-length'],
        phase: 'empty_request_body'
      });
      // No issue, we'll use the subscription ID from params
    }
    
    try {
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
      
      // Process the subscription
      logger.info('Processing subscription', { subscription_id: id });
      
      // We check first if the subscription is valid and initiate processing
      const result = await subscriptionProcessor.processSubscription(id);
      
      // Return successful response
      logger.info('Subscription queued for processing', { 
        subscription_id: id,
        result: result 
      });
      
      return res.status(202).json({
        status: 'success',
        message: 'Subscription queued for processing',
        processing_id: result.processing_id
      });
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

  return router;
}

module.exports = createProcessRouter;