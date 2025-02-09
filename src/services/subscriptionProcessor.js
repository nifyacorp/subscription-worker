const { getLogger } = require('../config/logger');
const processorRegistry = require('./processors/registry');

const logger = getLogger('subscription-processor');

class SubscriptionProcessor {
  constructor(pool, parserApiKey) {
    this.pool = pool;
    this.logger = getLogger('subscription-processor');
    this.processors = new Map();
    
    // Initialize processors with configuration
    for (const type of processorRegistry.getRegisteredTypes()) {
      this.processors.set(type, processorRegistry.createProcessor(type, { apiKey: parserApiKey }));
    }
  }

  async processSubscriptions() {
    this.logger.debug({
      processors: Array.from(this.processors.keys()),
      pool_total: this.pool.totalCount,
      pool_idle: this.pool.idleCount,
      pool_waiting: this.pool.waitingCount
    }, 'Starting batch subscription processing');
    
    const startTime = Date.now();
    
    const client = await this.pool.connect();
    this.logger.debug({
      connection_time_ms: Date.now() - startTime
    }, 'Acquired database client');
    
    try {
      const queryStartTime = Date.now();
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
        query_time_ms: Date.now() - queryStartTime,
        total_time_ms: Date.now() - startTime
      }, 'Retrieved pending subscriptions');

      if (result.rows.length === 0) {
        this.logger.debug('No pending subscriptions found');
        return;
      }

      // Process each subscription
      const processingResults = [];
      for (const subscription of result.rows) {
        try {
          const subStartTime = Date.now();
          this.logger.debug({ 
            subscription_id: subscription.subscription_id,
            type: subscription.type_id,
            prompts_count: subscription.prompts?.length,
            frequency: subscription.frequency,
            last_check_at: subscription.last_check_at
          }, 'Processing subscription');

          // Update to processing status
          const updateStartTime = Date.now();
          await client.query(`
            UPDATE subscription_processing
            SET status = 'processing',
                last_run_at = NOW()
            WHERE id = $1
          `, [subscription.processing_id]);
          this.logger.debug({
            update_time_ms: Date.now() - updateStartTime
          }, 'Updated subscription status to processing');

          // Process based on subscription type
          let processingResult;
          const processor = this.processors.get(subscription.type_id);
          if (!processor) {
            this.logger.warn({
              type: subscription.type_id,
              available_processors: Array.from(this.processors.keys())
            }, 'No processor found for subscription type');
            throw new Error(`No processor available for type: ${subscription.type_id}`);
          }

          const analysisStartTime = Date.now();
          processingResult = await processor.analyzeContent(subscription.prompts);
          this.logger.debug({
            analysis_time_ms: Date.now() - analysisStartTime,
            matches_found: processingResult?.results?.length || 0
          }, 'Content analysis completed');

          if (processingResult?.results?.length > 0) {
            const notifyStartTime = Date.now();
            // Create notifications for matches
            const notificationValues = processingResult.results.map(result => ({
              user_id: subscription.user_id,
              subscription_id: subscription.subscription_id,
              title: `${subscription.type_id.toUpperCase()} Match: ${result.matches[0]?.title || 'New match found'}`,
              content: result.matches[0]?.summary || 'Content match found',
              source_url: result.matches[0]?.links?.html || '',
              metadata: {
                match_type: subscription.type_id,
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
            this.logger.debug({
              notifications_created: notificationValues.length,
              notification_time_ms: Date.now() - notifyStartTime
            }, 'Created notifications for matches');
          }

          // Update processing status to completed
          const completeStartTime = Date.now();
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

          this.logger.debug({
            complete_time_ms: Date.now() - completeStartTime,
            total_sub_time_ms: Date.now() - subStartTime
          }, 'Updated subscription status to completed');
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
            subscription_id: subscription.subscription_id,
            error_name: error.name,
            error_code: error.code,
            error_message: error.message,
            stack: error.stack
          }, 'Failed to process subscription, continuing with next');

          // Update to failed status
          const failureStartTime = Date.now();
          await client.query(`
            UPDATE subscription_processing
            SET 
              status = 'failed',
              error = $1,
              next_run_at = NOW() + INTERVAL '5 minutes'
            WHERE id = $2
          `, [error.message, subscription.processing_id]);

          this.logger.debug({
            failure_update_time_ms: Date.now() - failureStartTime
          }, 'Updated subscription status to failed');

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
        total_processing_time_ms: Date.now() - startTime,
        success_count: processingResults.filter(r => r.status === 'success').length,
        error_count: processingResults.filter(r => r.status === 'error').length
      }, 'Completed processing subscriptions');

      return processingResults;

    } catch (error) {
      this.logger.error({
        error,
        error_name: error.name,
        error_code: error.code,
        error_message: error.message,
        stack: error.stack,
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