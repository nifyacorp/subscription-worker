const express = require('express');
const { getLogger } = require('../config/logger');

const logger = getLogger('subscription-route');
const router = express.Router();

function createSubscriptionRouter(subscriptionProcessor) {
  router.get('/pending-subscriptions', async (req, res) => {
    try {
      logger.debug('Fetching pending subscriptions');
      const client = await subscriptionProcessor.pool.connect();
      
      try {
        const result = await client.query(`
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
          WHERE sp.status = 'pending'
            AND sp.next_run_at <= NOW()
            AND s.active = true
        `);

        const response = {
          subscriptions: result.rows,
          count: result.rows.length
        };


        res.status(200).json(response);
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error({ 
        error,
        errorName: error.name,
        errorCode: error.code,
        errorMessage: error.message
      }, 'Failed to fetch pending subscriptions');
      
      res.status(500).json({ 
        error: 'Failed to fetch pending subscription actions'
      });
    }
  });

  router.post('/process-subscription/:id', async (req, res) => {
    const { id } = req.params;
    const client = await subscriptionProcessor.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get subscription details
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
        FOR UPDATE
      `, [id]);

      if (subscriptionResult.rows.length === 0) {
        await client.query('COMMIT');
        return res.status(404).json({ error: 'No active pending subscription found' });
      }

      const subscription = subscriptionResult.rows[0];

      // Update to processing status
      await client.query(`
        UPDATE subscription_processing
        SET status = 'processing',
            last_run_at = NOW()
        WHERE id = $1
      `, [subscription.processing_id]);

      try {
        // Process subscription based on type
        let processingResult;
        if (subscription.type_id === 'boe') {
          processingResult = await subscriptionProcessor.boeController.processSubscription({
            subscription_id: subscription.subscription_id,
            metadata: subscription.metadata,
            prompts: subscription.prompts
          });

          // Create notifications for matches
          if (processingResult?.results?.length > 0) {
            const notificationValues = processingResult.results.map(result => ({
              user_id: subscription.user_id,
              subscription_id: subscription.subscription_id,
              title: `BOE Match: ${result.matches[0]?.title || 'New match found'}`,
              content: result.matches[0]?.summary || 'Content match found',
              source_url: result.matches[0]?.links?.html || '',
              metadata: {
                match_type: 'boe',
                relevance_score: result.matches[0]?.relevance_score,
                prompt: result.prompt
              }
            }));

            for (const notification of notificationValues) {
              await client.query(`
                INSERT INTO notifications (
                  user_id,
                  subscription_id,
                  title,
                  content,
                  source_url,
                  metadata
                ) VALUES ($1, $2, $3, $4, $5, $6)
              `, [
                notification.user_id,
                notification.subscription_id,
                notification.title,
                notification.content,
                notification.source_url,
                notification.metadata
              ]);
            }
          }
        }

        // Update processing status to completed
        const nextRunInterval = subscription.frequency === 'daily' 
          ? 'INTERVAL \'1 day\'' 
          : 'INTERVAL \'1 hour\'';

        await client.query(`
          UPDATE subscription_processing
          SET 
            status = 'completed',
            next_run_at = NOW() + ${nextRunInterval},
            metadata = jsonb_set(
              metadata,
              '{last_run_stats}',
              $1::jsonb
            ),
            error = NULL
          WHERE id = $2
        `, [JSON.stringify({
          processed_at: new Date().toISOString(),
          matches_found: processingResult?.results?.length || 0,
          processing_time_ms: processingResult?.metadata?.processing_time_ms
        }), subscription.processing_id]);

        // Update subscription last check time
        await client.query(`
          UPDATE subscriptions
          SET 
            last_check_at = NOW(),
            updated_at = NOW()
          WHERE id = $1
        `, [subscription.subscription_id]);

        await client.query('COMMIT');

        res.status(200).json({
          status: 'success',
          subscription_id: subscription.subscription_id,
          matches_found: processingResult?.results?.length || 0
        });

      } catch (error) {
        // Handle processing error
        await client.query(`
          UPDATE subscription_processing
          SET 
            status = 'failed',
            error = $1,
            next_run_at = NOW() + INTERVAL '5 minutes'
          WHERE id = $2
        `, [error.message, subscription.processing_id]);

        await client.query('COMMIT');

        logger.error({ 
          error,
          subscription_id: subscription.subscription_id 
        }, 'Failed to process subscription');

        res.status(500).json({ 
          error: 'Failed to process subscription',
          details: error.message
        });
      }

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error }, 'Database error while processing subscription');
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  });

  router.post('/process-subscriptions', async (req, res) => {
    try {
      await subscriptionProcessor.processSubscriptions();
      res.status(200).json({ status: 'success' });
    } catch (error) {
      logger.error({ error }, 'Failed to process subscriptions');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = createSubscriptionRouter;