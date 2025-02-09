const { getLogger } = require('../../config/logger');
const logger = getLogger('subscription-process');

const SUBSCRIPTION_STATES = {
  PENDING: 'pending',     // Initial state, ready to be sent
  SENDING: 'sending',     // Being sent to processor
  PROCESSING: 'processing' // Processor confirmed receipt, now processing
};

async function processSubscriptionAsync(subscription, subscriptionProcessor) {
  const client = await subscriptionProcessor.pool.connect();
  
  try {
    await client.query('BEGIN');

    if (subscription.type_id === 'boe') {
      // Send to BOE processor and wait for 200 response
      await subscriptionProcessor.boeController.processSubscription({
        subscription_id: subscription.subscription_id,
        metadata: subscription.metadata,
        prompts: subscription.prompts
      });

      // If we get here, processor accepted the request
      await client.query(`
        UPDATE subscription_processing
        SET status = $1,
            last_run_at = NOW()
        WHERE id = $2
      `, [SUBSCRIPTION_STATES.PROCESSING, subscription.processing_id]);
    }

    await client.query('COMMIT');
    
    logger.info({
      subscription_id: subscription.subscription_id,
      type: subscription.type_id
    }, 'Subscription sent to processor successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    
    logger.error({ 
      error,
      subscription_id: subscription.subscription_id,
      type: subscription.type_id
    }, 'Failed to process subscription asynchronously');
    
    await client.query(`
      UPDATE subscription_processing
      SET 
        status = $3, 
        error = $1,
        next_run_at = NOW() + INTERVAL '5 minutes'
      WHERE id = $2
    `, [error.message, subscription.processing_id, SUBSCRIPTION_STATES.PENDING]);
    
  } finally {
    client.release();
  }
}

function createProcessRouter(subscriptionProcessor) {
  const router = require('express').Router();

  router.post('/process-subscription/:id', async (req, res) => {
    const { id } = req.params;
    const client = await subscriptionProcessor.pool.connect();

    try {
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
        WHERE sp.subscription_id = $1
          AND sp.status = 'pending'
          AND sp.next_run_at <= NOW()
          AND s.active = true
        FOR UPDATE SKIP LOCKED
      `, [id]);

      if (subscriptionResult.rows.length === 0) {
        await client.query('COMMIT');
        return res.status(404).json({ error: 'No active pending subscription found' });
      }

      const subscription = subscriptionResult.rows[0];

      await client.query(`
        UPDATE subscription_processing
        SET status = $2,
            last_run_at = NOW()
        WHERE id = $1
      `, [subscription.processing_id, SUBSCRIPTION_STATES.SENDING]);

      await client.query('COMMIT');

      // Start async processing
      processSubscriptionAsync(subscription, subscriptionProcessor).catch(error => {
        logger.error({ 
          error,
          subscription_id: subscription.subscription_id 
        }, 'Async processing failed');
      });

      // Return immediate response
      res.status(202).json({
        status: 'accepted',
        message: 'Subscription processing started',
        subscription_id: subscription.subscription_id
      });

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error }, 'Database error while processing subscription');
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
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