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
      debug_mode: true,
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
      
      this.logger.debug({
        query: `SELECT pending subscriptions WHERE status = 'pending' AND active = true AND (frequency = 'immediate' OR next_run_at <= NOW())`,
        timestamp: new Date().toISOString()
      }, 'Executing subscription query');

      // Get all pending subscriptions
      const result = await client.query(`
        SELECT 
          sp.id as processing_id,
          sp.subscription_id,
          sp.metadata,
          s.user_id,
          st.name as type_name,
          s.prompts,
          s.frequency,
          s.last_check_at
        FROM subscription_processing sp
        JOIN subscriptions s ON s.id = sp.subscription_id
        JOIN subscription_types st ON st.id = s.type_id
        WHERE (sp.status = 'pending' OR (sp.status = 'failed' AND sp.next_run_at <= NOW()))
          AND s.active = true
          AND (
            s.frequency = 'immediate'
            OR sp.next_run_at <= NOW()
          )
        FOR UPDATE SKIP LOCKED
      `);

      // Log detailed subscription data
      if (result.rows.length > 0) {
        this.logger.debug({ 
          query_result: {
            total_rows: result.rows.length,
            rows: result.rows.map(row => ({
              processing_id: row.processing_id,
              subscription_id: row.subscription_id,
              type_name: row.type_name,
              frequency: row.frequency,
              status: row.status,
              next_run_at: row.next_run_at
            }))
          },
          first_subscription: {
            ...result.rows[0],
            metadata_type: result.rows[0].metadata?.type,
            type_id: result.rows[0].type_id,
            subscription_id: result.rows[0].subscription_id,
            processing_id: result.rows[0].processing_id
          }
        }, 'First pending subscription details');
      }

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
            processing_id: subscription.processing_id,
            type: subscription.type_name,
            metadata: subscription.metadata,
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
          // Debug log available processors
          const processorType = 'boe'; // Force BOE processor since it's our only type
          const processor = this.processors.get(processorType);

          if (!processor) {
            this.logger.warn({
              type: processorType,
              subscription_details: {
                id: subscription.subscription_id,
                processing_id: subscription.processing_id,
                metadata: subscription.metadata,
                type_name: processorType
              },
              available_processors: Array.from(this.processors.keys())
            }, 'No processor found for subscription type');
            throw new Error(`No processor available for type: ${processorType}`);
          }

          const analysisStartTime = Date.now();
          this.logger.debug({
            subscription_id: subscription.subscription_id,
            prompts: subscription.prompts,
            processor_type: processorType,
            parser_url: processor.client?.defaults?.baseURL
          }, 'Starting content analysis');

          processingResult = await processor.analyzeContent({
            prompts: subscription.prompts,
            user_id: subscription.user_id,
            subscription_id: subscription.subscription_id
          });
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
              title: `${subscription.type_name} Match: ${result.matches[0]?.title || 'New match found'}`,
              content: result.matches[0]?.summary || 'Content match found',
              source_url: result.matches[0]?.links?.html || '',
              metadata: {
                match_type: subscription.type_name,
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
          const errorContext = {
            error: {
              name: error.name,
              code: error.code,
              message: error.message,
              stack: error.stack,
              response: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
              } : undefined
            },
            subscription: {
              id: subscription.subscription_id,
              processing_id: subscription.processing_id,
              type: subscription.type_name,
              user_id: subscription.user_id,
              frequency: subscription.frequency,
              prompts_count: subscription.prompts?.length
            },
            timing: {
              last_check_at: subscription.last_check_at,
              last_run_at: subscription.last_run_at,
              next_run_at: subscription.next_run_at
            },
            system: {
              processors: Array.from(this.processors.keys()),
              pool_stats: {
                total: this.pool.totalCount,
                idle: this.pool.idleCount,
                waiting: this.pool.waitingCount
              }
            }
          };

          this.logger.error({ 
            ...errorContext
          }, 'Failed to process subscription, continuing with next');

          // Update to failed status
          const failureStartTime = Date.now();
          const errorMessage = error.response?.data?.error || error.message;
          await client.query(`
            UPDATE subscription_processing
            SET 
              status = 'failed',
              error = $1::text,
              metadata = jsonb_set(
                metadata,
                '{last_error}',
                $3::jsonb
              ),
              next_run_at = NOW() + INTERVAL '5 minutes'
            WHERE id = $2
          `, [
            errorMessage,
            subscription.processing_id,
            JSON.stringify({
              timestamp: new Date().toISOString(),
              error: errorContext.error,
              context: {
                subscription: errorContext.subscription,
                timing: errorContext.timing
              }
            })
          ]);

          this.logger.debug({
            failure_update_time_ms: Date.now() - failureStartTime
          }, 'Updated subscription status to failed');

          processingResults.push({
            subscription_id: subscription.subscription_id,
            status: 'error',
            error: errorMessage,
            error_details: {
              type: error.name,
              code: error.code,
              response_status: error.response?.status
            }
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
      const batchErrorContext = {
        error: {
          name: error.name,
          code: error.code,
          message: error.message,
          stack: error.stack,
          response: error.response ? {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data
          } : undefined
        },
        timing: {
          start_time: startTime,
          processing_time_ms: Date.now() - startTime
        },
        system: {
          processors: Array.from(this.processors.keys()),
          pool_stats: {
            total: this.pool.totalCount,
            idle: this.pool.idleCount,
            waiting: this.pool.waitingCount
          }
        }
      };

      this.logger.error({
        ...batchErrorContext
      }, 'Failed to process subscriptions batch');
      throw error;
    } finally {
      client.release();
      this.logger.debug('Released database client');
    }
  }
}

module.exports = SubscriptionProcessor;