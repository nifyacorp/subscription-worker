const { getLogger } = require('../../config/logger'); 
const logger = getLogger('subscription-process');

const SUBSCRIPTION_STATES = {
  PENDING: 'pending',     // Initial state, ready to be sent
  SENDING: 'sending',     // Being sent to processor
  PROCESSING: 'processing' // Processor confirmed receipt, now processing
};

async function processSubscriptionAsync(subscription, subscriptionProcessor) {
  logger.debug({
    subscription_id: subscription.subscription_id,
    processing_id: subscription.processing_id,
    type_id: subscription.type_id,
    prompts: subscription.prompts,
    metadata: JSON.stringify(subscription.metadata),
    phase: 'start_async_processing'
  }, 'Starting async subscription processing');

  const client = await subscriptionProcessor.pool.connect();
  
  try {
    await client.query('BEGIN');
    logger.debug('Transaction started for subscription processing');

    if (subscription.type_id === 'boe') {
      const requestPayload = {
        subscription_id: subscription.subscription_id,
        metadata: subscription.metadata,
        prompts: subscription.prompts
      };
      
      logger.debug({
        subscription_id: subscription.subscription_id,
        type: 'boe',
        request_payload: JSON.stringify(requestPayload),
        boe_controller_type: typeof subscriptionProcessor.boeController,
        boe_controller_methods: Object.keys(subscriptionProcessor.boeController || {}),
        processor_keys: Object.keys(subscriptionProcessor || {}),
        phase: 'pre_boe_processor_call'
      }, 'Preparing to send to BOE processor');

      try {
        // Send to BOE processor and wait for 200 response
        const processorResponse = await subscriptionProcessor.boeController.processSubscription(requestPayload);

        logger.debug({
          subscription_id: subscription.subscription_id,
          response: typeof processorResponse === 'object' ? JSON.stringify(processorResponse) : processorResponse,
          phase: 'post_boe_processor_call'
        }, 'BOE processor response received');
      } catch (boeError) {
        logger.error({
          error: boeError,
          subscription_id: subscription.subscription_id,
          message: boeError.message,
          stack: boeError.stack,
          phase: 'boe_processor_call_error'
        }, 'Error calling BOE processor');
        throw boeError;
      }

      // If we get here, processor accepted the request
      logger.debug({
        subscription_id: subscription.subscription_id,
        processing_id: subscription.processing_id,
        status: SUBSCRIPTION_STATES.PROCESSING,
        phase: 'updating_status'
      }, 'Updating subscription processing status');

      try {
        await client.query(`
          UPDATE subscription_processing
          SET status = $1,
              last_run_at = NOW()
          WHERE id = $2
        `, [SUBSCRIPTION_STATES.PROCESSING, subscription.processing_id]);
      } catch (dbError) {
        logger.error({
          error: dbError,
          subscription_id: subscription.subscription_id,
          processing_id: subscription.processing_id,
          phase: 'update_subscription_status'
        }, 'Database error updating subscription status');
        throw dbError;
      }
    } else {
      logger.warn({
        subscription_id: subscription.subscription_id,
        type_id: subscription.type_id
      }, 'Unsupported subscription type');
      throw new Error(`Unsupported subscription type: ${subscription.type_id}`);
    }

    logger.debug('Committing transaction');
    await client.query('COMMIT');
    
    logger.info({
      subscription_id: subscription.subscription_id,
      type: subscription.type_id
    }, 'Subscription sent to processor successfully');
    
  } catch (error) {
    logger.error({ 
      error,
      message: error.message,
      stack: error.stack,
      subscription_id: subscription.subscription_id,
      type: subscription.type_id,
      phase: 'process_subscription_async'
    }, 'Failed to process subscription asynchronously');
    
    try {
      logger.debug('Rolling back transaction');
      await client.query('ROLLBACK');
      
      logger.debug({
        subscription_id: subscription.subscription_id,
        processing_id: subscription.processing_id,
        error: error.message
      }, 'Updating subscription with error status');
      
      await client.query(`
        UPDATE subscription_processing
        SET 
          status = $3, 
          error = $1,
          next_run_at = NOW() + INTERVAL '5 minutes'
        WHERE id = $2
      `, [error.message, subscription.processing_id, SUBSCRIPTION_STATES.PENDING]);
    } catch (rollbackError) {
      logger.error({
        error: rollbackError,
        original_error: error.message,
        subscription_id: subscription.subscription_id,
        phase: 'rollback_error'
      }, 'Error during rollback');
    }
    
  } finally {
    client.release();
    logger.debug({
      subscription_id: subscription.subscription_id,
      phase: 'client_release'
    }, 'Database client released');
  }
}

function createProcessRouter(subscriptionProcessor) {
  const router = require('express').Router();

  router.post('/process-subscription/:id', async (req, res) => {
    const { id } = req.params;
    logger.debug({ 
      subscription_id: id,
      body: req.body,
      body_json: JSON.stringify(req.body),
      body_type: typeof req.body,
      body_length: req.body ? Object.keys(req.body).length : 0,
      headers: req.headers,
      method: req.method,
      path: req.path,
      phase: 'request_received'
    }, 'Process subscription request received');

    // Si el cuerpo está vacío, agregar un log de advertencia
    if (!req.body || Object.keys(req.body).length === 0) {
      logger.warn({
        subscription_id: id,
        body_empty: true,
        headers: req.headers,
        content_type: req.headers['content-type'],
        content_length: req.headers['content-length'],
        phase: 'empty_request_body'
      }, 'Request body is empty, this might cause problems with some processors');
    }
    
    let client;
    
    try {
      logger.debug('Connecting to database');
      client = await subscriptionProcessor.dbService.pool.connect();
      logger.debug('Database connection established');

      try {
        logger.debug({
          subscription_id: id,
          query: 'SELECT subscription details'
        }, 'Querying subscription details');
        
        const subscriptionResult = await client.query(`
          SELECT 
            sp.id as processing_id,
            sp.subscription_id,
            sp.metadata,
            s.user_id,
            s.type_id,
            s.prompts,
            s.frequency,
            s.last_check_at
          FROM subscription_processing sp
          JOIN subscriptions s ON s.id = sp.subscription_id
          WHERE sp.subscription_id = $1 AND s.active = true
          FOR UPDATE SKIP LOCKED
        `, [id]);

        logger.debug({
          subscription_id: id,
          rows_found: subscriptionResult.rows.length
        }, 'Query result received');

        if (subscriptionResult.rows.length === 0) {
          logger.warn({
            subscription_id: id
          }, 'No active pending subscription found');
          
          await client.query('COMMIT');
          return res.status(404).json({ error: 'No active pending subscription found' });
        }

        const subscription = subscriptionResult.rows[0];
        logger.debug({
          subscription: subscription
        }, 'Subscription details retrieved');

        try {
          logger.debug({
            processing_id: subscription.processing_id,
            status: SUBSCRIPTION_STATES.SENDING
          }, 'Updating subscription processing status to SENDING');
          
          await client.query(`
            UPDATE subscription_processing
            SET status = $2,
                last_run_at = NOW()
            WHERE id = $1
          `, [subscription.processing_id, SUBSCRIPTION_STATES.SENDING]);
          
          logger.debug('Status updated successfully');
        } catch (updateError) {
          logger.error({
            error: updateError,
            processing_id: subscription.processing_id,
            phase: 'update_status'
          }, 'Error updating subscription status');
          throw updateError;
        }

        logger.debug('Committing transaction');
        await client.query('COMMIT');
        logger.debug('Transaction committed successfully');

        // Start async processing
        logger.debug({
          subscription_id: subscription.subscription_id
        }, 'Starting async processing');
        
        processSubscriptionAsync(subscription, subscriptionProcessor).catch(error => {
          logger.error({ 
            error,
            message: error.message,
            stack: error.stack,
            subscription_id: subscription.subscription_id 
          }, 'Async processing failed');
        });

        logger.debug({
          subscription_id: subscription.subscription_id
        }, 'Sending success response');
        
        // Return immediate response
        res.status(202).json({
          status: 'accepted',
          message: 'Subscription processing started',
          subscription_id: subscription.subscription_id
        });

      } catch (error) {
        logger.error({
          error,
          message: error.message,
          stack: error.stack,
          subscription_id: id,
          phase: 'subscription_processing'
        }, 'Error processing subscription');
        
        try {
          logger.debug('Rolling back transaction');
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          logger.error({ 
            error: rollbackError,
            original_error: error.message,
            phase: 'rollback' 
          }, 'Error during rollback');
        }
        
        throw error;
      }
    } catch (error) {
      logger.error({ 
        error,
        message: error.message,
        stack: error.stack,
        subscription_id: id
      }, 'Database error while processing subscription');
      
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        details: error.stack
      });
    } finally {
      if (client) {
        logger.debug('Releasing database client');
        client.release();
      }
    }
  });

  router.post('/process-subscriptions', async (req, res) => {
    let allSubscriptions;
    try {
      // First get all subscriptions for debugging
      const client = await subscriptionProcessor.pool.connect();
      try {
        logger.debug('Fetching all subscriptions for debugging');
        allSubscriptions = await client.query(`
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
            s.active,
            s.prompts,
            s.frequency,
            s.last_check_at,
            s.created_at,
            s.updated_at
          FROM subscription_processing sp
          JOIN subscriptions s ON s.id = sp.subscription_id
          WHERE (sp.status = 'pending' OR (sp.status = 'failed' AND sp.next_run_at <= NOW()))
            AND s.active = true
            AND sp.next_run_at <= NOW()
          ORDER BY sp.next_run_at ASC
        `);

        logger.debug({
          phase: 'debug_info',
          total_subscriptions: allSubscriptions.rows.length,
          subscriptions: allSubscriptions.rows,
          timestamp: new Date().toISOString(),
          query: 'SELECT * FROM subscription_processing sp JOIN subscriptions s ON s.id = sp.subscription_id'
        }, 'Current state of all subscriptions');

      } finally {
        client.release();
      }

      const results = await subscriptionProcessor.processSubscriptions();
      
      if (!results || results.length === 0) {
        return res.status(200).json({
          status: 'success',
          message: 'No pending subscriptions to process',
          debug: {
            total_subscriptions: allSubscriptions.rows.length,
            subscriptions: allSubscriptions.rows
          }
        });
      }

      res.status(200).json({
        status: 'success',
        processed: results.length,
        results: results,
        debug: {
          total_subscriptions: allSubscriptions.rows.length,
          subscriptions: allSubscriptions.rows
        }
      });

    } catch (error) {
      logger.error({ error }, 'Failed to process subscriptions');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = createProcessRouter;