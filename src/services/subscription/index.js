const { getLogger } = require('../../config/logger');
const processorRegistry = require('../processors/registry');
const DatabaseService = require('./database');
const NotificationService = require('./notification');
const ProcessingService = require('./processing');
const BOEProcessor = require('../processors/boe');

const logger = getLogger('subscription-processor');

class SubscriptionProcessor {
  constructor(pool, parserApiKey) {
    this.pool = pool;
    this.parserApiKey = parserApiKey;
    this.logger = getLogger('subscription-processor');
    
    // Explicitly initialize the BOE controller
    try {
      const BOEProcessor = require('../processors/boe');
      this.boeController = new BOEProcessor({
        BOE_API_KEY: this.parserApiKey,
        BOE_API_URL: process.env.BOE_API_URL || 'https://boe-parser-415554190254.us-central1.run.app'
      });
      
      this.logger.info('BOE Controller initialized successfully', {
        controller_type: typeof this.boeController,
        has_process_method: typeof this.boeController.processSubscription === 'function'
      });
    } catch (error) {
      this.logger.error('Failed to initialize BOE controller', {
        error: error.message,
        stack: error.stack
      });
      // We don't throw here to allow other functionalities to work
    }
    
    // Map subscription types to their processors
    this.processorMap = {
      'boe': this.boeController,
      // Add other processors as needed
    };
    
    this.logger.debug('SubscriptionProcessor initialized', {
      pool_connected: !!pool,
      api_key_present: !!parserApiKey,
      processors_available: Object.keys(this.processorMap)
    });
  }
  
  /**
   * Process a single subscription by ID
   * @param {string} subscriptionId - The ID of the subscription to process
   * @returns {Promise<object>} Processing result
   */
  async processSubscription(subscriptionId) {
    const logger = getLogger('subscription-processor');
    logger.debug('Processing subscription by ID', { subscription_id: subscriptionId });
    
    if (!subscriptionId) {
      logger.error('No subscription ID provided');
      throw new Error('Subscription ID is required');
    }
    
    try {
      // First, get the subscription details from the database
      const client = await this.pool.connect();
      
      try {
        const result = await client.query(
          `SELECT 
            s.id as subscription_id, 
            s.user_id, 
            s.type_id, 
            s.prompts, 
            s.frequency,
            s.active,
            s.last_check_at,
            s.metadata,
            st.slug as type_slug
          FROM subscriptions s
          JOIN subscription_types st ON s.type_id = st.id
          WHERE s.id = $1`,
          [subscriptionId]
        );
        
        if (result.rowCount === 0) {
          logger.error('Subscription not found', { subscription_id: subscriptionId });
          throw new Error(`Subscription with ID ${subscriptionId} not found`);
        }
        
        const subscription = result.rows[0];
        
        // Check if subscription is active
        if (!subscription.active) {
          logger.warn('Attempting to process inactive subscription', { subscription_id: subscriptionId });
          return { status: 'skipped', message: 'Subscription is inactive' };
        }
        
        // Create a processing record for this run
        const processingInsert = await client.query(
          `INSERT INTO subscription_processings
           (subscription_id, status, metadata)
           VALUES ($1, 'pending', $2)
           RETURNING id`,
          [subscriptionId, JSON.stringify(subscription.metadata || {})]
        );
        
        const processingId = processingInsert.rows[0].id;
        
        logger.debug('Created processing record', {
          subscription_id: subscriptionId,
          processing_id: processingId
        });
        
        // Prepare subscription data with all necessary information
        const subscriptionData = {
          subscription_id: subscription.subscription_id,
          processing_id: processingId,
          user_id: subscription.user_id,
          type_id: subscription.type_id,
          type_slug: subscription.type_slug,
          prompts: subscription.prompts,
          frequency: subscription.frequency,
          metadata: subscription.metadata || {}
        };
        
        // Determine which processor to use
        let processor = null;
        if (subscription.type_slug === 'boe') {
          processor = this.boeController;
        } else {
          // Try to find a processor based on the type_id
          processor = this.processorMap[subscription.type_id] || this.processorMap[subscription.type_slug];
        }
        
        if (!processor) {
          logger.error('No processor available for subscription type', {
            subscription_id: subscriptionId,
            type_id: subscription.type_id,
            type_slug: subscription.type_slug
          });
          
          // Update processing record to error
          await client.query(
            `UPDATE subscription_processings
             SET status = 'error', result = $1, updated_at = NOW()
             WHERE id = $2`,
            [
              JSON.stringify({
                error: 'No processor available for this subscription type',
                timestamp: new Date().toISOString()
              }),
              processingId
            ]
          );
          
          throw new Error(`No processor available for subscription type ${subscription.type_slug || subscription.type_id}`);
        }
        
        logger.debug('Delegating to process subscription async', {
          subscription_id: subscriptionId,
          processor_type: processor.constructor.name || typeof processor
        });
        
        // Process the subscription asynchronously
        const processPromise = processSubscriptionAsync(subscriptionData, {
          pool: this.pool,
          boeController: processor
        });
        
        // We don't await this promise - it will run in the background
        processPromise.catch(error => {
          logger.error('Unhandled error in async processing', {
            subscription_id: subscriptionId,
            error: error.message,
            stack: error.stack
          });
        });
        
        return {
          status: 'accepted',
          message: 'Subscription processing started',
          processing_id: processingId
        };
        
      } finally {
        client.release();
        logger.debug('Database client released');
      }
    } catch (error) {
      logger.error('Error processing subscription', {
        subscription_id: subscriptionId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async processSubscriptions() {
    this.logger.debug({
      processors: Array.from(this.processors.keys()),
      debug_mode: true,
      pool_total: this.pool.totalCount,
      pool_idle: this.pool.idleCount,
      pool_waiting: this.pool.waitingCount,
      boe_controller_exists: !!this.boeController,
      boe_processor_exists: !!this.processors.get('boe')
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