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
    
    try {
      await client.query('BEGIN');
      logger.debug('Started database transaction');

      const boeSubscriptions = await this.boeController.getPendingSubscriptions(this.pool);
      logger.info({ count: boeSubscriptions.length }, 'Retrieved BOE subscriptions');

      for (const subscription of boeSubscriptions) {
        await this.processSubscription(client, subscription);
      }

      await client.query('COMMIT');
      logger.debug('Committed database transaction');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.debug('Rolled back database transaction');
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
      SET status = $1,
          ${status === 'processing' ? 'last_run_at' : 'next_run_at'} = NOW() ${status !== 'processing' ? '+ INTERVAL \'5 minutes\'' : ''},
          error = $2
      WHERE subscription_id = $3
    `;
    await client.query(query, [status, error, subscriptionId]);
    logger.debug({ subscriptionId, status }, 'Updated subscription status');
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