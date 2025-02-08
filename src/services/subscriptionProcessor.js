const { getLogger } = require('../config/logger');
const BOEController = require('../controllers/boe-parser');

const logger = getLogger('subscription-processor');

class SubscriptionProcessor {
  constructor(pool, parserApiKey) {
    this.pool = pool;
    this.boeController = new BOEController(parserApiKey);
    this.logger = getLogger('subscription-processor');
  }

  async processSubscriptions() {
    this.logger.debug('Starting batch subscription processing');
    const startTime = Date.now();
    
    const client = await this.pool.connect();
    this.logger.debug('Acquired database client');
    
    try {
      // Get all pending subscriptions
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
        FOR UPDATE SKIP LOCKED
      `);

      this.logger.info({ 
        subscriptions_found: result.rows.length,
        query_time_ms: Date.now() - startTime
      }, 'Retrieved pending subscriptions');

      if (result.rows.length === 0) {
        this.logger.debug('No pending subscriptions found');
        return;
      }

      // Process each subscription
      const processingResults = [];
      for (const subscription of result.rows) {
        try {
          this.logger.debug({ 
            subscription_id: subscription.subscription_id,
            type: subscription.type_id
          }, 'Processing subscription');

          // Update to processing status
          await client.query(`
            UPDATE subscription_processing
            SET status = 'processing',
                last_run_at = NOW()
            WHERE id = $1
          `, [subscription.processing_id]);

          // Process based on subscription type
          let processingResult;
          if (subscription.type_id === 'boe') {
            processingResult = await this.boeController.processSubscription({
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

          processingResults.push({
            subscription_id: subscription.subscription_id,
            status: 'success',
            matches_found: processingResult?.results?.length || 0
          });

        } catch (error) {
          this.logger.error({ 
            error,
            subscription_id: subscription.subscription_id
          }, 'Failed to process subscription, continuing with next');

          // Update to failed status
          await client.query(`
            UPDATE subscription_processing
            SET 
              status = 'failed',
              error = $1,
              next_run_at = NOW() + INTERVAL '5 minutes'
            WHERE id = $2
          `, [error.message, subscription.processing_id]);

          processingResults.push({
            subscription_id: subscription.subscription_id,
            status: 'error',
            error: error.message
          });
        }
      }

      this.logger.info({
        total_time: Date.now() - startTime,
        processed_count: result.rows.length,
        success_count: processingResults.filter(r => r.status === 'success').length,
        error_count: processingResults.filter(r => r.status === 'error').length
      }, 'Completed processing subscriptions');

      return processingResults;

    } catch (error) {
      this.logger.error({
        error,
        processing_time: Date.now() - startTime
      }, 'Failed to process subscriptions batch');
      throw error;
    } finally {
      client.release();
      this.logger.debug('Released database client');
    }
  }
}

module.exports = SubscriptionProcessor;