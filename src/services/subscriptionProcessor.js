const { getLogger } = require('../config/logger');
const BOEController = require('../controllers/boe-parser');

const logger = getLogger('subscription-processor');

class SubscriptionProcessor {
  constructor(pool, parserApiKey) {
    this.pool = pool;
    this.boeController = new BOEController(parserApiKey);
  }

  async processSubscriptions() {
    const client = await this.pool.connect();
    logger.debug('Acquired database client');
    const startTime = Date.now();
    
    try {
      await client.query('BEGIN');
      logger.debug('Started database transaction');

      const boeSubscriptions = await this.boeController.getPendingSubscriptions(this.pool);
      logger.info({ 
        count: boeSubscriptions.length,
        query_time: Date.now() - startTime
      }, 'Retrieved BOE subscriptions');

      if (boeSubscriptions.length === 0) {
        logger.debug('No pending subscriptions found');
        await client.query('COMMIT');
        return;
      }

      for (const subscription of boeSubscriptions) {
        try {
          await this.processSubscription(client, subscription);
        } catch (error) {
          logger.error({ 
            error,
            subscription_id: subscription.subscription_id
          }, 'Failed to process subscription, continuing with next');
          // Continue with next subscription instead of failing entire batch
          continue;
        }
      }

      await client.query('COMMIT');
      logger.info({
        total_time: Date.now() - startTime,
        processed_count: boeSubscriptions.length
      }, 'Completed processing subscriptions');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({
        error,
        processing_time: Date.now() - startTime
      }, 'Failed to process subscriptions batch');
      throw error;
    } finally {
      client.release();
      logger.debug('Released database client');
    }
  }

  async processSubscription(client, subscription) {
    try {
      await this.updateSubscriptionStatus(client, subscription.subscription_id, 'processing');
      
      const parserResult = await this.boeController.processSubscription(subscription);
      
      await this.createNotification(client, subscription.subscription_id, parserResult);
      await this.updateSubscriptionStatus(client, subscription.subscription_id, 'completed');
      
    } catch (error) {
      logger.error({ error, subscriptionId: subscription.subscription_id }, 'Failed to process subscription');
      await this.updateSubscriptionStatus(client, subscription.subscription_id, 'failed', error.message);
    }
  }

  async updateSubscriptionStatus(client, subscriptionId, status, error = null) {
    const query = `
      UPDATE subscription_processing
      SET 
        status = $1,
        last_run_at = CASE WHEN $1 = 'processing' THEN NOW() ELSE last_run_at END,
        next_run_at = CASE WHEN $1 != 'processing' THEN NOW() + INTERVAL '5 minutes' ELSE next_run_at END,
        error = $2,
        updated_at = NOW()
      WHERE subscription_id = $3
      RETURNING subscription_id, status, last_run_at, next_run_at
    `;
    const result = await client.query(query, [status, error, subscriptionId]);
    logger.info({ 
      subscriptionId,
      status,
      updated: result.rows[0]
    }, 'Updated subscription status');
  }

  async createNotification(client, subscriptionId, content) {
    await client.query(`
      INSERT INTO notifications (subscription_id, content, created_at)
      VALUES ($1, $2, NOW())
    `, [subscriptionId, JSON.stringify(content)]);
    logger.debug({ subscriptionId }, 'Created notification');
  }
}

module.exports = SubscriptionProcessor;