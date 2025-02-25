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
    this.logger.info('Processing subscription', { subscription_id: subscriptionId });

    // Check for a valid subscription id
    if (!subscriptionId || subscriptionId === 'undefined') {
      this.logger.error('Invalid subscription id provided', { subscription_id: subscriptionId });
      throw new Error('Invalid subscription id provided');
    }

    let knex;
    try {
      knex = await this.connectToDatabase();

      // Query for the subscription
      let subscription = await knex('subscriptions')
        .where('id', subscriptionId)
        .first();

      // Check if the subscription exists
      if (!subscription) {
        this.logger.error('Subscription not found', { subscription_id: subscriptionId });
        throw new Error(`Subscription not found for id: ${subscriptionId}`);
      }

      // Check if the subscription is active
      if (!subscription.is_active) {
        this.logger.warn('Subscription is not active', { subscription_id: subscriptionId });
        throw new Error(`Subscription is not active for id: ${subscriptionId}`);
      }

      this.logger.debug('Found active subscription', {
        subscription_id: subscriptionId,
        type_slug: subscription.type_slug,
        type_id: subscription.type_id,
        is_active: subscription.is_active
      });

      // Prepare subscription data for processing
      let subscriptionData = {
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        created_at: subscription.created_at,
        metadata: subscription.metadata || {}
      };

      // Extract prompts from metadata if present
      if (subscription.metadata) {
        try {
          // If metadata is a string, try to parse it
          if (typeof subscription.metadata === 'string') {
            try {
              subscriptionData.metadata = JSON.parse(subscription.metadata);
            } catch (parseError) {
              this.logger.warn('Failed to parse metadata as JSON', {
                subscription_id: subscriptionId,
                error: parseError.message,
                metadata: subscription.metadata.substring(0, 100)
              });
            }
          }
          
          // Add prompts directly to the subscription data for easier access by processors
          if (subscriptionData.metadata && subscriptionData.metadata.prompts) {
            subscriptionData.prompts = subscriptionData.metadata.prompts;
            this.logger.debug('Extracted prompts from metadata', {
              subscription_id: subscriptionId,
              prompt_count: Array.isArray(subscriptionData.prompts) ? subscriptionData.prompts.length : 'not an array'
            });
          }
        } catch (metadataError) {
          this.logger.error('Error processing subscription metadata', {
            subscription_id: subscriptionId,
            error: metadataError.message
          });
        }
      }

      // Get the processor based on the subscription type
      const processor = this.getProcessorForSubscription(subscription);
      
      if (!processor) {
        this.logger.error('No processor found for subscription type', {
          subscription_id: subscriptionId,
          type_slug: subscription.type_slug,
          type_id: subscription.type_id,
          available_processors: Object.keys(this.processors)
        });
        
        await this.updateProcessingError(knex, subscriptionId, 'No processor found for subscription type');
        throw new Error(`No processor found for subscription type: ${subscription.type_slug}`);
      }

      this.logger.debug('Using processor for subscription', {
        subscription_id: subscriptionId,
        processor_type: processor.constructor.name,
        has_process_method: typeof processor.processSubscription === 'function'
      });

      // Check if the processor has the required method
      if (typeof processor.processSubscription !== 'function') {
        const errorMessage = `Processor does not have processSubscription method`;
        this.logger.error(errorMessage, {
          subscription_id: subscriptionId,
          processor_type: processor.constructor.name
        });
        
        await this.updateProcessingError(knex, subscriptionId, errorMessage);
        throw new Error(errorMessage);
      }

      try {
        // Process the subscription asynchronously
        this.logger.info('Starting subscription processing', {
          subscription_id: subscriptionId,
          processor: processor.constructor.name
        });
        
        // Call the processor to process the subscription
        const result = await processor.processSubscription(subscriptionData);
        
        this.logger.info('Subscription processing completed', {
          subscription_id: subscriptionId,
          status: result?.status || 'unknown',
          matches_count: result?.matches?.length || 0,
          entries_count: result?.entries?.length || 0,
          result_available: !!result
        });
        
        // Check if the processor returned an error status
        if (result && result.status === 'error') {
          this.logger.warn('Processor returned error status', {
            subscription_id: subscriptionId,
            error: result.error,
            processor: processor.constructor.name
          });
          
          await this.updateProcessingError(knex, subscriptionId, result.error || 'Unknown processor error');
          return {
            status: 'error',
            error: result.error || 'Unknown processor error',
            subscription_id: subscriptionId
          };
        }
        
        // Update the processing record to completed status
        await this.updateProcessingSuccess(knex, subscriptionId);
        
        return result;
      } catch (processingError) {
        this.logger.error('Error during subscription processing', {
          subscription_id: subscriptionId,
          error: processingError.message,
          stack: processingError.stack
        });
        
        await this.updateProcessingError(knex, subscriptionId, processingError.message);
        throw processingError;
      }
    } catch (error) {
      this.logger.error('Error in processSubscription', {
        subscription_id: subscriptionId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      if (knex) {
        try {
          await knex.destroy();
        } catch (err) {
          this.logger.error('Error destroying database connection', {
            error: err.message
          });
        }
      }
    }
  }

  /**
   * Update processing record with error status
   * @param {Object} knex - Knex database connection
   * @param {string} subscriptionId - Subscription ID
   * @param {string} errorMessage - Error message
   */
  async updateProcessingError(knex, subscriptionId, errorMessage) {
    try {
      // Find the latest processing record for this subscription
      const processing = await knex('subscription_processings')
        .where('subscription_id', subscriptionId)
        .orderBy('created_at', 'desc')
        .first();
      
      if (processing) {
        await knex('subscription_processings')
          .where('id', processing.id)
          .update({
            status: 'error',
            updated_at: new Date(),
            error: errorMessage?.substring(0, 255) || 'Unknown error'
          });
        
        this.logger.debug('Updated processing record with error status', {
          subscription_id: subscriptionId,
          processing_id: processing.id,
          error: errorMessage
        });
      }
    } catch (error) {
      this.logger.error('Error updating processing record with error status', {
        subscription_id: subscriptionId,
        error: error.message
      });
    }
  }
  
  /**
   * Update processing record with success status
   * @param {Object} knex - Knex database connection
   * @param {string} subscriptionId - Subscription ID
   */
  async updateProcessingSuccess(knex, subscriptionId) {
    try {
      // Find the latest processing record for this subscription
      const processing = await knex('subscription_processings')
        .where('subscription_id', subscriptionId)
        .orderBy('created_at', 'desc')
        .first();
      
      if (processing) {
        await knex('subscription_processings')
          .where('id', processing.id)
          .update({
            status: 'completed',
            updated_at: new Date(),
            error: null
          });
        
        this.logger.debug('Updated processing record with completed status', {
          subscription_id: subscriptionId,
          processing_id: processing.id
        });
      }
    } catch (error) {
      this.logger.error('Error updating processing record with completed status', {
        subscription_id: subscriptionId,
        error: error.message
      });
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