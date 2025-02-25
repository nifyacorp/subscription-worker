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
    // Enhanced logging for tracking
    this.logger.info('Processing subscription', { 
      subscription_id: subscriptionId,
      process_started_at: new Date().toISOString()
    });

    // Check for a valid subscription id
    if (!subscriptionId || subscriptionId === 'undefined' || subscriptionId === 'null') {
      this.logger.error('Invalid subscription id provided', { subscription_id: subscriptionId });
      return { 
        status: 'error',
        error: 'Invalid subscription id provided',
        subscription_id: subscriptionId
      };
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
        return {
          status: 'error',
          error: `Subscription not found for id: ${subscriptionId}`,
          subscription_id: subscriptionId
        };
      }

      // Check if the subscription is active but continue processing regardless
      if (!subscription.is_active) {
        this.logger.warn('Subscription is not active', { 
          subscription_id: subscriptionId,
          is_active: false
        });
        // We'll still process it, but log a warning
      }

      this.logger.debug('Found subscription', {
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
              // Continue with the original metadata as string
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
          // Continue with empty metadata rather than failing
          subscriptionData.metadata = {};
        }
      }

      // Get the processor based on the subscription type
      const processor = this.getProcessorForSubscription(subscription);
      
      if (!processor) {
        this.logger.error('No processor found for subscription type', {
          subscription_id: subscriptionId,
          type_slug: subscription.type_slug,
          type_id: subscription.type_id,
          available_processors: Object.keys(this.processorMap)
        });
        
        await this.updateProcessingError(knex, subscriptionId, 'No processor found for subscription type');
        return {
          status: 'error',
          error: `No processor found for subscription type: ${subscription.type_slug}`,
          subscription_id: subscriptionId
        };
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
        return {
          status: 'error',
          error: errorMessage,
          subscription_id: subscriptionId
        };
      }

      // Try to process the subscription and handle any errors gracefully
      try {
        // Process the subscription asynchronously - pass the full subscription data
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
        
        // Handle error status from processor
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
            subscription_id: subscriptionId,
            processing_id: result.processing_id
          };
        }
        
        // Update the processing record to completed status
        const processingRecord = await this.updateProcessingSuccess(knex, subscriptionId);
        
        return {
          status: 'success',
          subscription_id: subscriptionId,
          processing_id: processingRecord?.id,
          entries_count: result?.entries?.length || 0,
          completed_at: new Date().toISOString()
        };
      } catch (error) {
        this.logger.error('Error during subscription processing', {
          subscription_id: subscriptionId,
          error: error.message,
          stack: error.stack
        });
        
        // Attempt to update processing status as error
        await this.updateProcessingError(knex, subscriptionId, error.message || 'Unknown error during processing');
        
        return {
          status: 'error',
          error: error.message || 'Unknown error during processing',
          subscription_id: subscriptionId
        };
      } finally {
        // Ensure database connection is cleaned up
        if (knex) {
          try {
            await knex.destroy();
          } catch (dbError) {
            this.logger.error('Error closing database connection', { 
              error: dbError.message 
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Error in subscription processing workflow', {
        subscription_id: subscriptionId,
        error: error.message,
        stack: error.stack
      });
      
      return {
        status: 'error',
        error: error.message,
        subscription_id: subscriptionId
      };
    }
  }

  /**
   * Update the processing record with error status
   * @param {Object} knex - Knex database instance
   * @param {string} subscriptionId - Subscription ID
   * @param {string} errorMessage - Error message
   * @returns {Promise<Object>} Updated processing record
   */
  async updateProcessingError(knex, subscriptionId, errorMessage) {
    try {
      // Try to find an existing processing record for this subscription
      let processingRecord = await knex('subscription_processing')
        .where('subscription_id', subscriptionId)
        .orderBy('created_at', 'desc')
        .first();
      
      if (processingRecord) {
        // Update the existing record
        const updated = await knex('subscription_processing')
          .where('id', processingRecord.id)
          .update({
            status: 'error',
            error_message: errorMessage || 'Unknown error',
            updated_at: new Date()
          })
          .returning('*');
        
        this.logger.debug('Updated processing record with error status', {
          subscription_id: subscriptionId,
          processing_id: processingRecord.id,
          error: errorMessage
        });
        
        return updated[0];
      } else {
        // Create a new processing record
        const newRecord = await knex('subscription_processing')
          .insert({
            subscription_id: subscriptionId,
            status: 'error',
            error_message: errorMessage || 'Unknown error',
            created_at: new Date(),
            updated_at: new Date()
          })
          .returning('*');
        
        this.logger.debug('Created new processing record with error status', {
          subscription_id: subscriptionId,
          processing_id: newRecord[0].id,
          error: errorMessage
        });
        
        return newRecord[0];
      }
    } catch (error) {
      this.logger.error('Error updating processing record', {
        subscription_id: subscriptionId,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Update the processing record with success status
   * @param {Object} knex - Knex database instance
   * @param {string} subscriptionId - Subscription ID
   * @returns {Promise<Object>} Updated processing record
   */
  async updateProcessingSuccess(knex, subscriptionId) {
    try {
      // Try to find an existing processing record for this subscription
      let processingRecord = await knex('subscription_processing')
        .where('subscription_id', subscriptionId)
        .orderBy('created_at', 'desc')
        .first();
      
      if (processingRecord) {
        // Update the existing record
        const updated = await knex('subscription_processing')
          .where('id', processingRecord.id)
          .update({
            status: 'completed',
            error_message: null,
            updated_at: new Date()
          })
          .returning('*');
        
        this.logger.debug('Updated processing record with success status', {
          subscription_id: subscriptionId,
          processing_id: processingRecord.id
        });
        
        return updated[0];
      } else {
        // Create a new processing record
        const newRecord = await knex('subscription_processing')
          .insert({
            subscription_id: subscriptionId,
            status: 'completed',
            created_at: new Date(),
            updated_at: new Date()
          })
          .returning('*');
        
        this.logger.debug('Created new processing record with success status', {
          subscription_id: subscriptionId,
          processing_id: newRecord[0].id
        });
        
        return newRecord[0];
      }
    } catch (error) {
      this.logger.error('Error updating processing record', {
        subscription_id: subscriptionId,
        error: error.message
      });
      return null;
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

  /**
   * Get the appropriate processor for a subscription
   * @param {Object} subscription - The subscription object
   * @returns {Object|null} The processor for the subscription type, or null if not found
   */
  getProcessorForSubscription(subscription) {
    if (!subscription) {
      this.logger.error('Cannot get processor for null or undefined subscription');
      return null;
    }
    
    // First try to get the processor from type_slug
    let processorKey = subscription.type_slug;
    
    // If no type_slug, try other fields
    if (!processorKey) {
      // Check for type.slug
      if (subscription.type && subscription.type.slug) {
        processorKey = subscription.type.slug;
      }
      // Check for type as a direct value
      else if (subscription.type) {
        processorKey = subscription.type;
      }
    }
    
    // If still no processor key, use a default (currently only BOE is supported)
    if (!processorKey) {
      this.logger.warn('No type information in subscription, defaulting to BOE', {
        subscription_id: subscription.id || 'unknown',
        subscription_fields: Object.keys(subscription)
      });
      processorKey = 'boe';
    }
    
    // Log the processor mapping for debugging
    this.logger.debug('Looking up processor', {
      processor_key: processorKey,
      available_processors: Object.keys(this.processorMap),
      processor_found: !!this.processorMap[processorKey]
    });
    
    return this.processorMap[processorKey] || null;
  }

  /**
   * Connect to the database and get a knex instance
   * @returns {Promise<Object>} Knex instance
   */
  async connectToDatabase() {
    try {
      // Connect to the database
      const client = await this.pool.connect();
      
      // Create a knex instance with the client
      const knex = require('knex')({
        client: 'pg',
        connection: () => Promise.resolve(client)
      });
      
      // Store client reference for cleanup in finally block
      knex.client = client;
      
      this.logger.debug('Database connection established');
      return knex;
    } catch (error) {
      this.logger.error('Failed to connect to database', {
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Database connection failed: ${error.message}`);
    }
  }
}

module.exports = SubscriptionProcessor;