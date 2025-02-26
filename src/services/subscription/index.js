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
  async processSubscription(subscriptionId, options = {}) {
    const logger = this.logger.child({ 
      subscription_id: subscriptionId,
      context: 'process_subscription'
    });
    
    logger.debug('Processing subscription', { 
      options: JSON.stringify(options),
      subscription_id: subscriptionId
    });

    // Check if we're using a mock pool
    if (this.pool && this.pool._mockPool) {
      logger.error('Cannot process subscription with mock database pool', { 
        subscription_id: subscriptionId,
        mock_pool: true
      });
      return {
        status: 'error',
        error: 'Database unavailable',
        message: 'The subscription processor is using a mock database pool. Please ensure PostgreSQL is running and accessible.',
        retryable: true,
        subscription_id: subscriptionId
      };
    }
    
    // Ensure we have a subscription ID
    if (!subscriptionId) {
      logger.error('No subscription ID provided');
      return {
        status: 'error',
        error: 'Missing subscription ID',
        message: 'A subscription ID is required to process a subscription',
        retryable: false
      };
    }

    // Enhanced logging for tracking
    logger.info('Processing subscription', { 
      subscription_id: subscriptionId,
      process_started_at: new Date().toISOString()
    });

    // Check for a valid subscription id
    if (!subscriptionId || subscriptionId === 'undefined' || subscriptionId === 'null') {
      logger.error('Invalid subscription id provided', { subscription_id: subscriptionId });
      return { 
        status: 'error',
        error: 'Invalid subscription id provided',
        subscription_id: subscriptionId
      };
    }

    let knex;
    let connectionAttempts = 0;
    const MAX_CONNECTION_ATTEMPTS = 3;
    
    // Try to establish a database connection with retries
    while (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
      connectionAttempts++;
      try {
        logger.debug(`Database connection attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS}`, {
          subscription_id: subscriptionId
        });
        
        knex = await this.connectToDatabase();
        break; // Connection successful, exit the retry loop
      } catch (connectionError) {
        // If we've reached the max attempts, throw the error
        if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
          logger.error(`Failed to connect to database after ${MAX_CONNECTION_ATTEMPTS} attempts`, {
            subscription_id: subscriptionId,
            error: connectionError.message
          });
          return {
            status: 'error',
            error: `Database connection failed after ${MAX_CONNECTION_ATTEMPTS} attempts: ${connectionError.message}`,
            subscription_id: subscriptionId,
            retryable: true
          };
        }
        
        // Log the error and retry
        logger.warn(`Database connection attempt ${connectionAttempts} failed, retrying...`, {
          subscription_id: subscriptionId,
          error: connectionError.message,
          retry_count: connectionAttempts
        });
        
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * connectionAttempts));
      }
    }

    try {
      // Query for the subscription
      const subscriptionQueryResult = await knex.query(
        'SELECT * FROM subscriptions WHERE id = $1 LIMIT 1', 
        [subscriptionId]
      );
      
      const subscription = subscriptionQueryResult.rows[0];

      // Check if the subscription exists
      if (!subscription) {
        logger.error('Subscription not found', { subscription_id: subscriptionId });
        return {
          status: 'error',
          error: `Subscription not found for id: ${subscriptionId}`,
          subscription_id: subscriptionId
        };
      }

      // Check if the subscription is active but continue processing regardless
      if (!subscription.is_active) {
        logger.warn('Subscription is not active', { 
          subscription_id: subscriptionId,
          is_active: false
        });
        // We'll still process it, but log a warning
      }

      logger.debug('Found subscription', {
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
              logger.warn('Failed to parse metadata as JSON', {
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
            logger.debug('Extracted prompts from metadata', {
              subscription_id: subscriptionId,
              prompt_count: Array.isArray(subscriptionData.prompts) ? subscriptionData.prompts.length : 'not an array'
            });
          }
        } catch (metadataError) {
          logger.error('Error processing subscription metadata', {
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
        logger.error('No processor found for subscription type', {
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

      logger.debug('Using processor for subscription', {
        subscription_id: subscriptionId,
        processor_type: processor.constructor.name,
        has_process_method: typeof processor.processSubscription === 'function'
      });

      // Check if the processor has the required method
      if (typeof processor.processSubscription !== 'function') {
        const errorMessage = `Processor does not have processSubscription method`;
        logger.error(errorMessage, {
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
        logger.info('Starting subscription processing', {
          subscription_id: subscriptionId,
          processor: processor.constructor.name
        });
        
        // Call the processor to process the subscription
        const result = await processor.processSubscription(subscriptionData);
        
        logger.info('Subscription processing completed', {
          subscription_id: subscriptionId,
          status: result?.status || 'unknown',
          matches_count: result?.matches?.length || 0,
          entries_count: result?.entries?.length || 0,
          result_available: !!result
        });
        
        // Handle error status from processor
        if (result && result.status === 'error') {
          logger.warn('Processor returned error status', {
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
        const updateQuery = `
          UPDATE subscription_processing 
          SET status = 'completed', last_run_at = NOW(), next_run_at = NOW() + INTERVAL '1 day', updated_at = NOW()
          WHERE subscription_id = $1
          RETURNING *
        `;
        const processingRecordResult = await knex.query(updateQuery, [subscriptionId]);
        const processingRecord = processingRecordResult.rows[0];
        
        return {
          status: 'success',
          subscription_id: subscriptionId,
          processing_id: processingRecord?.id,
          entries_count: result?.entries?.length || 0,
          completed_at: new Date().toISOString()
        };
      } catch (error) {
        logger.error('Error during subscription processing', {
          subscription_id: subscriptionId,
          error: error.message,
          stack: error.stack
        });
        
        // Attempt to update processing status as error
        const errorUpdateQuery = `
          UPDATE subscription_processing 
          SET status = 'failed', error = $2, updated_at = NOW()
          WHERE subscription_id = $1
          RETURNING *
        `;
        await knex.query(errorUpdateQuery, [subscriptionId, error.message || 'Unknown error during processing']);
        
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
            logger.error('Error closing database connection', { 
              error: dbError.message 
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error in subscription processing workflow', {
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
      const query = `
        UPDATE subscription_processing
        SET status = 'failed', error = $2, updated_at = NOW()
        WHERE subscription_id = $1
        RETURNING *
      `;
      const result = await knex.query(query, [subscriptionId, errorMessage]);
      
      if (result.rows.length === 0) {
        // If no processing record exists, create one
        const insertQuery = `
          INSERT INTO subscription_processing
          (subscription_id, status, error, created_at, updated_at)
          VALUES ($1, 'failed', $2, NOW(), NOW())
          RETURNING *
        `;
        const insertResult = await knex.query(insertQuery, [subscriptionId, errorMessage]);
        return insertResult.rows[0];
      }
      
      return result.rows[0];
    } catch (error) {
      this.logger.error('Error updating processing status to error', {
        subscription_id: subscriptionId,
        error: error.message,
        original_error: errorMessage
      });
      // We don't throw here to avoid cascading errors
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
      // Update subscription_processing table
      const query = `
        UPDATE subscription_processing
        SET status = 'completed', last_run_at = NOW(), next_run_at = NOW() + INTERVAL '1 day', updated_at = NOW()
        WHERE subscription_id = $1
        RETURNING *
      `;
      const result = await knex.query(query, [subscriptionId]);
      
      if (result.rows.length === 0) {
        // If no processing record exists, create one
        const insertQuery = `
          INSERT INTO subscription_processing
          (subscription_id, status, last_run_at, next_run_at, created_at, updated_at)
          VALUES ($1, 'completed', NOW(), NOW() + INTERVAL '1 day', NOW(), NOW())
          RETURNING *
        `;
        const insertResult = await knex.query(insertQuery, [subscriptionId]);
        return insertResult.rows[0];
      }
      
      return result.rows[0];
    } catch (error) {
      this.logger.error('Error updating processing status to success', {
        subscription_id: subscriptionId,
        error: error.message
      });
      // We don't throw here to avoid cascading errors
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
    let client = null;
    
    try {
      // Connect to the database
      this.logger.debug('Attempting to acquire database client from pool', {
        pool_stats: {
          total_count: this.pool.totalCount,
          idle_count: this.pool.idleCount,
          waiting_count: this.pool.waitingCount
        }
      });
      
      client = await this.pool.connect();
      
      this.logger.debug('Successfully acquired database client', {
        connection_active: !!client,
        client_properties: client ? Object.keys(client) : [],
        client_methods: client ? Object.getOwnPropertyNames(Object.getPrototypeOf(client)) : [],
        pool_stats: {
          total_count: this.pool.totalCount,
          idle_count: this.pool.idleCount,
          waiting_count: this.pool.waitingCount
        }
      });
      
      // Test basic connectivity with raw query
      try {
        await client.query('SELECT 1 as connection_test');
        this.logger.debug('Basic client query test successful');
        
        // Instead of creating a knex instance, we'll return a simplified wrapper
        // that provides basic query functionality compatible with our code
        return {
          client: client,
          // Basic query method
          query: async (text, params) => {
            return client.query(text, params);
          },
          // Raw query that mimics knex.raw
          raw: async (text, params) => {
            return client.query(text, params);
          },
          // Select from table
          select: async (columns) => {
            return {
              from: async (table) => {
                return {
                  where: async (column, value) => {
                    const query = `SELECT ${columns} FROM ${table} WHERE ${column} = $1`;
                    const result = await client.query(query, [value]);
                    return result.rows;
                  },
                  first: async () => {
                    const query = `SELECT ${columns} FROM ${table} LIMIT 1`;
                    const result = await client.query(query);
                    return result.rows[0];
                  }
                };
              }
            };
          },
          // Method to simulate knex('table').where(...)
          table: (tableName) => {
            return {
              where: (column, value) => {
                return {
                  first: async () => {
                    const query = `SELECT * FROM ${tableName} WHERE ${column} = $1 LIMIT 1`;
                    const result = await client.query(query, [value]);
                    return result.rows[0] || null;
                  },
                  update: async (updates) => {
                    // Build UPDATE query
                    const setClause = Object.entries(updates)
                      .map(([key, _], index) => `${key} = $${index + 2}`)
                      .join(', ');
                    const values = [value, ...Object.values(updates)];
                    const query = `UPDATE ${tableName} SET ${setClause} WHERE ${column} = $1 RETURNING *`;
                    const result = await client.query(query, values);
                    return result.rows;
                  }
                };
              }
            };
          },
          // Cleanup method
          destroy: async () => {
            if (client) {
              await client.release();
              this.logger.debug('Released database client in destroy method');
            }
          }
        };
      } catch (rawQueryError) {
        this.logger.error('Basic client query test failed', {
          error: rawQueryError.message,
          code: rawQueryError.code,
          stack: rawQueryError.stack
        });
        throw rawQueryError;
      }
    } catch (error) {
      this.logger.error('Failed to connect to database', {
        error: error.message,
        error_code: error.code,
        error_type: error.constructor.name,
        stack: error.stack,
        pool_stats: {
          total_count: this.pool ? this.pool.totalCount : null,
          idle_count: this.pool ? this.pool.idleCount : null,
          waiting_count: this.pool ? this.pool.waitingCount : null
        }
      });
      throw new Error(`Database connection failed: ${error.message}`);
    } finally {
      // Clean up the client if it wasn't assigned to our wrapper
      if (client && !client._assigned) {
        try {
          client.release();
          this.logger.debug('Released database client in finally block');
        } catch (releaseError) {
          this.logger.error('Failed to release client in finally block', {
            error: releaseError.message,
            code: releaseError.code
          });
        }
      }
    }
  }
}

module.exports = SubscriptionProcessor;