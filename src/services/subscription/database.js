const { getLogger } = require('../../config/logger');

const logger = getLogger('subscription-database');

class DatabaseService {
  constructor(pool) {
    this.pool = pool;
    this.logger = logger;
  }

  async getPendingSubscriptions(client) {
    const queryStartTime = Date.now();
    
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
      WHERE s.active = true AND (
        s.frequency = 'immediate'
        OR (
          (sp.status = 'pending' OR (sp.status = 'failed' AND sp.next_run_at <= NOW()))
          AND sp.next_run_at <= NOW()
        )
      )
      FOR UPDATE SKIP LOCKED
    `);

    this.logger.debug({
      subscriptions_found: result.rows.length,
      query_time_ms: Date.now() - queryStartTime
    }, 'Retrieved pending subscriptions');

    return result.rows;
  }

  async updateProcessingStatus(client, processingId, status) {
    await client.query(`
      UPDATE subscription_processing
      SET status = $2,
          last_run_at = NOW()
      WHERE id = $1
    `, [processingId, status]);
  }

  async completeProcessing(client, subscription, result) {
    const nextRunInterval = subscription.frequency === 'daily' 
      ? 'INTERVAL \'1 day\'' 
      : 'INTERVAL \'1 hour\'';

    // Update processing status
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
      matches_found: result.matches.length,
      processing_time_ms: result.processing_time_ms
    }), subscription.processing_id]);

    // Update subscription last check time
    await client.query(`
      UPDATE subscriptions
      SET 
        last_check_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `, [subscription.subscription_id]);
  }

  async handleProcessingFailure(client, subscription, error) {
    const errorMessage = error.response?.data?.error || error.message;
    const errorContext = {
      timestamp: new Date().toISOString(),
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        response: error.response
      },
      subscription: {
        id: subscription.subscription_id,
        type: subscription.type_name
      }
    };

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
    `, [errorMessage, subscription.processing_id, JSON.stringify(errorContext)]);
  }
}

module.exports = DatabaseService;