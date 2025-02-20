const { getLogger } = require('../../config/logger');
const processorRegistry = require('../processors/registry');
const DatabaseService = require('./database');
const NotificationService = require('./notification');
const ProcessingService = require('./processing');

const logger = getLogger('subscription-processor');

class SubscriptionProcessor {
  constructor(pool, parserApiKey) {
    this.pool = pool;
    this.logger = logger;
    this.processors = new Map();
    
    // Initialize services
    this.dbService = new DatabaseService(pool);
    this.notificationService = new NotificationService(pool);
    this.processingService = new ProcessingService();
    
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
    
    try {
      // Get pending subscriptions
      const subscriptions = await this.dbService.getPendingSubscriptions(client);
      
      if (!subscriptions.length) {
        this.logger.debug('No pending subscriptions found');
        return;
      }

      // Process each subscription
      const processingResults = [];
      for (const subscription of subscriptions) {
        try {
          // Update status to processing
          await this.dbService.updateProcessingStatus(client, subscription.processing_id, 'processing');
          
          // Process the subscription
          const result = await this.processingService.processSubscription(
            subscription,
            this.processors.get('boe'), // Force BOE processor since it's our only type
            this.logger
          );

          // Create notifications for matches if any
          if (result.matches.length > 0) {
            await this.notificationService.createNotifications(client, subscription, result.matches);
          }

          // Update status to completed
          await this.dbService.completeProcessing(client, subscription, result);

          processingResults.push({
            subscription_id: subscription.subscription_id,
            status: 'success',
            matches_found: result.matches.length
          });

        } catch (error) {
          this.logger.error({ error }, 'Failed to process subscription');
          
          // Update to failed status
          await this.dbService.handleProcessingFailure(client, subscription, error);

          processingResults.push({
            subscription_id: subscription.subscription_id,
            status: 'error',
            error: error.message
          });
        }
      }

      this.logger.info({
        total_time: Date.now() - startTime,
        processed_count: subscriptions.length,
        success_count: processingResults.filter(r => r.status === 'success').length,
        error_count: processingResults.filter(r => r.status === 'error').length
      }, 'Completed processing subscriptions');

      return processingResults;

    } catch (error) {
      this.logger.error({ error }, 'Failed to process subscriptions batch');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = SubscriptionProcessor;