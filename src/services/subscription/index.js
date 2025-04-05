/**
 * Unified Subscription Processor Service
 * 
 * This service handles subscription processing with support for multiple processor types.
 * It provides a consistent interface for subscription processing and notification creation.
 */
const { getLogger } = require('../../config/logger');
const processorRegistry = require('../processors/registry');
const DatabaseService = require('./database');
const NotificationService = require('./notification');
const ProcessingService = require('./processing');
const BOEProcessor = require('../processors/boe');
const DOGAProcessor = require('../processors/doga');
const { publishNotificationMessage } = require('../../config/pubsub');
const { PubSub } = require('@google-cloud/pubsub');

const logger = getLogger('subscription-processor');

// Default values
const DEFAULT_PROMPTS = ['Información general', 'Noticias importantes'];
const DEFAULT_MATCH_LIMIT = 10;
const NOTIFICATION_TOPIC = process.env.NOTIFICATION_TOPIC || 'subscription-notifications';

class SubscriptionProcessor {
  /**
   * Create a new SubscriptionProcessor
   * @param {Object} pool - Database connection pool
   * @param {string} parserApiKey - API key for parser services
   */
  constructor(pool, parserApiKey) {
    this.pool = pool;
    this.parserApiKey = parserApiKey;
    this.logger = getLogger('subscription-processor');
    this.pubsub = null;
    
    // Initialize database service for consistent DB operations
    this.dbService = new DatabaseService(pool);
    this.notificationService = new NotificationService(pool);
    
    // Initialize PubSub if in production environment
    if (process.env.NODE_ENV === 'production') {
      try {
        this.pubsub = new PubSub({
          projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID
        });
        
        // Get the notification topic
        this.notificationTopic = this.pubsub.topic(NOTIFICATION_TOPIC);
        
        this.logger.info('PubSub initialized for notification publishing', {
          topic: NOTIFICATION_TOPIC
        });
      } catch (error) {
        this.logger.warn('Failed to initialize PubSub', {
          error: error.message
        });
      }
    }
    
    // Explicitly initialize processor controllers
    try {
      const boeConfig = {
        BOE_API_KEY: this.parserApiKey,
        BOE_API_URL: process.env.BOE_API_URL || 'https://boe-parser-415554190254.us-central1.run.app'
      };
      
      this.boeController = new BOEProcessor(boeConfig);
      
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
    
    // Initialize DOGA controller
    try {
      const dogaConfig = {
        DOGA_API_KEY: this.parserApiKey,
        DOGA_API_URL: process.env.DOGA_API_URL || 'https://doga-parser-415554190254.us-central1.run.app'
      };
      
      this.dogaController = new DOGAProcessor(dogaConfig);

      this.logger.info('DOGA Controller initialized successfully', {
        controller_type: typeof this.dogaController,
        has_process_method: typeof this.dogaController.processSubscription === 'function'
      });
    } catch (error) {
      this.logger.error('Failed to initialize DOGA controller', {
        error: error.message,
        stack: error.stack
      });
      // We don't throw here to allow other functionalities to work
    }
    
    // Map subscription types to their processors
    this.processorMap = {
      'boe': this.boeController,
      'doga': this.dogaController
      // Add other processors as needed
    };
    
    this.logger.debug('SubscriptionProcessor initialized', {
      pool_connected: !!pool,
      api_key_present: !!parserApiKey,
      processors_available: Object.keys(this.processorMap)
    });
  }
  
  /**
   * Normalize prompts to ensure they are in the correct format
   * @param {any} prompts - Prompts that could be string, array, or JSON string
   * @returns {string[]} - Normalized array of prompt strings
   */
  normalizePrompts(prompts) {
    if (!prompts) return DEFAULT_PROMPTS;
    
    if (Array.isArray(prompts)) {
      const filtered = prompts.filter(p => typeof p === 'string' && p.trim());
      return filtered.length > 0 ? filtered : DEFAULT_PROMPTS;
    }
    
    if (typeof prompts === 'string') {
      // Try to parse as JSON if it looks like an array
      if (prompts.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(prompts);
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter(p => typeof p === 'string' && p.trim());
            return filtered.length > 0 ? filtered : DEFAULT_PROMPTS;
          }
        } catch (e) {
          // Not valid JSON, treat as single prompt
        }
      }
      
      // Single prompt string
      return [prompts.trim()];
    }
    
    return DEFAULT_PROMPTS;
  }
  
  /**
   * Process a single subscription by ID
   * @param {string} subscriptionId - The ID of the subscription to process
   * @param {Object} options - Optional processing parameters
   * @returns {Promise<Object>} Processing result
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

    let client = null;
    let connectionAttempts = 0;
    const MAX_CONNECTION_ATTEMPTS = 3;
    
    // Try to establish a database connection with retries
    while (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
      connectionAttempts++;
      try {
        logger.debug(`Database connection attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS}`, {
          subscription_id: subscriptionId
        });
        
        client = await this.pool.connect();
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
      // Query for the subscription with type information
      const sqlQuery = `
        SELECT 
          s.*,
          t.name as type_name,
          t.id as type_id,
          t.slug as type_slug
        FROM 
          subscriptions s
        LEFT JOIN 
          subscription_types t ON s.type_id = t.id
        WHERE 
          s.id = $1 
        LIMIT 1
      `;
      
      logger.debug('Executing subscription query with type info', { 
        subscription_id: subscriptionId,
        sql_query: sqlQuery
      });
      
      const subscriptionQueryResult = await client.query(
        sqlQuery, 
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

      // Add detailed logging to see exactly what fields are available in the subscription
      logger.debug('Full subscription data from database', {
        subscription_id: subscriptionId,
        subscription_keys: Object.keys(subscription),
        prompts_exists: 'prompts' in subscription,
        prompts_type: subscription.prompts ? typeof subscription.prompts : 'undefined',
        type_id: subscription.type_id,
        type_slug: subscription.type_slug
      });

      // Prepare subscription data for processing
      let subscriptionData = {
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        created_at: subscription.created_at,
        metadata: subscription.metadata || {}
      };

      // Normalize prompts regardless of the format they come in
      subscriptionData.prompts = this.normalizePrompts(subscription.prompts);
      
      logger.debug('Normalized prompts for processing', {
        subscription_id: subscriptionId,
        original_prompts_type: typeof subscription.prompts,
        original_is_array: Array.isArray(subscription.prompts),
        normalized_prompts: subscriptionData.prompts,
        normalized_count: subscriptionData.prompts.length
      });

      // Only use metadata.prompts if we don't already have prompts and they exist in metadata
      if (!subscriptionData.prompts.length && subscription.metadata && subscription.metadata.prompts) {
        subscriptionData.prompts = this.normalizePrompts(subscription.metadata.prompts);
        
        logger.debug('Using prompts from metadata', {
          subscription_id: subscriptionId,
          metadata_prompts_type: typeof subscription.metadata.prompts,
          metadata_is_array: Array.isArray(subscription.metadata.prompts),
          normalized_prompts: subscriptionData.prompts,
          normalized_count: subscriptionData.prompts.length
        });
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
        
        await this.updateProcessingError(client, subscriptionId, 'No processor found for subscription type');
        return {
          status: 'error',
          error: `No processor found for subscription type: ${subscription.type_slug || 'unknown'}`,
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
        
        await this.updateProcessingError(client, subscriptionId, errorMessage);
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
          
          await this.updateProcessingError(client, subscriptionId, result.error || 'Unknown processor error');
          return {
            status: 'error',
            error: result.error || 'Unknown processor error',
            subscription_id: subscriptionId,
            processing_id: result.processing_id
          };
        }
        
        // Create notifications for matches if found
        if (result && (result.matches?.length > 0 || result.entries?.length > 0)) {
          const matches = result.matches || result.entries || [];
          
          if (matches.length > 0) {
            logger.info('Creating notifications for matches', {
              subscription_id: subscriptionId,
              matches_count: matches.length
            });
            
            try {
              // Create notifications in the database
              const notificationResult = await this.createNotifications(
                client,
                subscription,
                matches,
                subscription.type_slug || 'boe'
              );
              
              logger.info('Created notifications successfully', {
                subscription_id: subscriptionId,
                notifications_created: notificationResult.created,
                errors: notificationResult.errors
              });
              
              // Also publish to PubSub if available
              if (this.pubsub && this.notificationTopic) {
                try {
                  // Determine processor type from subscription
                  const processorType = subscription.type_slug || 'boe';
                  
                  // Forward the complete subscription data along with matches
                  const messageId = await publishNotificationMessage(
                    subscriptionData, 
                    matches, 
                    processorType
                  );
                  
                  logger.info('Successfully published notification message', {
                    subscription_id: subscriptionId,
                    message_id: messageId,
                    matches_count: matches.length
                  });
                } catch (pubsubError) {
                  logger.error('Failed to publish notification message', {
                    subscription_id: subscriptionId,
                    error: pubsubError.message,
                    stack: pubsubError.stack
                  });
                  // We continue processing despite the error
                }
              }
            } catch (notificationError) {
              logger.error('Error creating notifications', {
                subscription_id: subscriptionId,
                error: notificationError.message,
                stack: notificationError.stack
              });
              // Continue processing - notifications failure shouldn't fail the whole process
            }
          } else {
            logger.info('No matches to create notifications for', {
              subscription_id: subscriptionId
            });
          }
        }
        
        // Update the processing record to completed status
        try {
          const updateQuery = `
            UPDATE subscription_processing 
            SET status = 'completed', last_run_at = NOW(), next_run_at = NOW() + INTERVAL '1 day', updated_at = NOW()
            WHERE subscription_id = $1
            RETURNING *
          `;
          const processingRecordResult = await client.query(updateQuery, [subscriptionId]);
          
          // Also update the subscription last_processed_at
          await client.query(`
            UPDATE subscriptions
            SET last_processed_at = NOW(), updated_at = NOW()
            WHERE id = $1
          `, [subscriptionId]);
          
          const processingRecord = processingRecordResult.rows[0];
          
          return {
            status: 'success',
            subscription_id: subscriptionId,
            processing_id: processingRecord?.id,
            entries_count: result?.entries?.length || 0,
            matches_count: result?.matches?.length || 0,
            completed_at: new Date().toISOString()
          };
        } catch (updateError) {
          logger.error('Error updating processing record', {
            subscription_id: subscriptionId,
            error: updateError.message,
            stack: updateError.stack
          });
          
          // Still return success since the processing itself succeeded
          return {
            status: 'success',
            subscription_id: subscriptionId,
            warning: 'Processing successful but failed to update processing record',
            entries_count: result?.entries?.length || 0,
            matches_count: result?.matches?.length || 0,
            completed_at: new Date().toISOString()
          };
        }
      } catch (error) {
        logger.error('Error during subscription processing', {
          subscription_id: subscriptionId,
          error: error.message,
          stack: error.stack
        });
        
        // Attempt to update processing status as error
        try {
          const errorUpdateQuery = `
            UPDATE subscription_processing 
            SET status = 'failed', error = $2, updated_at = NOW()
            WHERE subscription_id = $1
            RETURNING *
          `;
          await client.query(errorUpdateQuery, [subscriptionId, error.message || 'Unknown error during processing']);
        } catch (updateError) {
          logger.error('Error updating processing record after failure', {
            subscription_id: subscriptionId,
            original_error: error.message,
            update_error: updateError.message
          });
        }
        
        return {
          status: 'error',
          error: error.message || 'Unknown error during processing',
          subscription_id: subscriptionId
        };
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
    } finally {
      // Ensure database connection is released
      if (client) {
        try {
          client.release();
          logger.debug('Database client released', {
            subscription_id: subscriptionId
          });
        } catch (releaseError) {
          logger.error('Error releasing database client', { 
            error: releaseError.message,
            subscription_id: subscriptionId
          });
        }
      }
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
   * Update the processing record with error status
   * @param {Object} client - Database client
   * @param {string} subscriptionId - Subscription ID
   * @param {string} errorMessage - Error message
   * @returns {Promise<Object>} Updated processing record
   */
  async updateProcessingError(client, subscriptionId, errorMessage) {
    try {
      const query = `
        UPDATE subscription_processing
        SET status = 'failed', error = $2, updated_at = NOW()
        WHERE subscription_id = $1
        RETURNING *
      `;
      const result = await client.query(query, [subscriptionId, errorMessage]);
      
      if (result.rows.length === 0) {
        // If no processing record exists, create one
        const insertQuery = `
          INSERT INTO subscription_processing
          (subscription_id, status, error, created_at, updated_at)
          VALUES ($1, 'failed', $2, NOW(), NOW())
          RETURNING *
        `;
        const insertResult = await client.query(insertQuery, [subscriptionId, errorMessage]);
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
   * Create notifications for a subscription based on matches
   * @param {Object} client - Database client
   * @param {Object} subscription - The subscription data
   * @param {Array<Object>} matches - The matches from the processor
   * @param {string} entityType - The type of entity (e.g., 'boe', 'doga')
   * @returns {Promise<Object>} Result of notification creation
   */
  async createNotifications(client, subscription, matches, entityType = 'boe') {
    if (!matches || matches.length === 0) {
      this.logger.info('No matches to create notifications for', {
        subscription_id: subscription.id,
        user_id: subscription.user_id
      });
      
      return { created: 0, errors: 0 };
    }
    
    const user_id = subscription.user_id;
    const subscription_id = subscription.id;
    let notificationsCreated = 0;
    let errors = 0;
    
    this.logger.info('Starting to create notifications', {
      user_id,
      subscription_id,
      match_count: matches.length
    });
    
    // Process each match and create notifications
    for (const match of matches) {
      try {
        // Generate a meaningful title for the notification
        const notificationTitle = match.notification_title || this.generateTitle(match);
        
        // Create entity_type for metadata
        const formattedEntityType = `${entityType}:${match.document_type?.toLowerCase() || 'document'}`;
        
        // Insert the notification into the database
        const result = await client.query(
          `INSERT INTO notifications (
            user_id,
            subscription_id,
            title,
            content,
            source_url,
            metadata,
            entity_type,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id`,
          [
            user_id,
            subscription_id,
            notificationTitle,
            match.summary || match.content || '',
            match.links?.html || match.url || '',
            JSON.stringify({
              prompt: match.prompt,
              relevance: match.relevance_score,
              document_type: match.document_type,
              original_title: match.title,
              publication_date: match.publication_date || match.dates?.publication_date,
              issuing_body: match.issuing_body,
              section: match.section,
              department: match.department
            }),
            formattedEntityType,
            new Date()
          ]
        );
        
        this.logger.info('Created notification', {
          user_id,
          subscription_id,
          notification_id: result.rows[0]?.id,
          title: notificationTitle,
          document_type: match.document_type,
          entity_type: formattedEntityType
        });
        
        notificationsCreated++;
      } catch (error) {
        errors++;
        this.logger.error('Failed to create notification', {
          user_id,
          subscription_id,
          error: error.message,
          error_code: error.code,
          stack: error.stack?.substring(0, 500) || 'No stack trace',
          title: match.notification_title || match.title
        });
        // Continue processing other notifications
      }
    }
    
    this.logger.info('Notification creation completed', {
      user_id,
      subscription_id,
      notifications_created: notificationsCreated,
      errors,
      success_rate: notificationsCreated > 0 ? 
        `${Math.round((notificationsCreated / (notificationsCreated + errors)) * 100)}%` : '0%'
    });
    
    return { created: notificationsCreated, errors };
  }

  /**
   * Generate a notification title from a document
   * @param {Object} doc - The document data
   * @returns {string} Generated title
   */
  generateTitle(doc) {
    // Try to use notification_title if available (optimized for display)
    if (doc.notification_title && doc.notification_title.length > 3 && 
        doc.notification_title !== 'string' && !doc.notification_title.includes('notification')) {
      return doc.notification_title;
    }
    
    // Otherwise try the original title
    if (doc.title && doc.title.length > 3 && 
        doc.title !== 'string' && !doc.title.includes('notification')) {
      // Truncate long titles for consistency
      return doc.title.length > 80 
        ? doc.title.substring(0, 77) + '...' 
        : doc.title;
    }
    
    // If both are missing, construct a descriptive title
    if (doc.document_type) {
      const docType = doc.document_type || 'Documento';
      const issuer = doc.issuing_body || doc.department || '';
      const date = doc.dates?.publication_date ? ` (${doc.dates.publication_date})` : '';
      
      return `${docType}${issuer ? ' de ' + issuer : ''}${date}`;
    }
    
    // Last resort - use basic info
    return `Alerta de documento: ${new Date().toLocaleDateString()}`;
  }

  /**
   * Process pending subscriptions in batch
   * @returns {Promise<Array>} Processing results
   */
  async processPendingSubscriptions() {
    this.logger.info('Starting batch subscription processing');
    
    if (!this.pool) {
      this.logger.error('No database pool available for batch processing');
      return { status: 'error', error: 'No database pool available' };
    }
    
    let client = null;
    try {
      client = await this.pool.connect();
      
      // Get pending subscriptions
      const query = `
        SELECT 
          sp.id as processing_id,
          sp.subscription_id,
          sp.status,
          sp.next_run_at,
          s.user_id,
          s.prompts,
          s.type_id,
          st.name as type_name,
          st.slug as type_slug
        FROM 
          subscription_processing sp
        JOIN 
          subscriptions s ON s.id = sp.subscription_id
        LEFT JOIN 
          subscription_types st ON s.type_id = st.id
        WHERE 
          sp.status = 'pending' 
          OR (sp.status = 'completed' AND sp.next_run_at < NOW())
        ORDER BY 
          sp.next_run_at ASC
        LIMIT 10
      `;
      
      const result = await client.query(query);
      
      if (result.rows.length === 0) {
        this.logger.info('No pending subscriptions found');
        return { status: 'success', processed: 0, subscriptions: [] };
      }
      
      const pendingSubscriptions = result.rows;
      this.logger.info(`Found ${pendingSubscriptions.length} pending subscriptions to process`);
      
      // Process each subscription
      const results = [];
      for (const subscription of pendingSubscriptions) {
        try {
          this.logger.info(`Processing subscription ${subscription.subscription_id}`);
          
          // Update status to in-progress
          await client.query(`
            UPDATE subscription_processing
            SET status = 'processing', updated_at = NOW()
            WHERE id = $1
          `, [subscription.processing_id]);
          
          // Process the subscription
          const processingResult = await this.processSubscription(subscription.subscription_id);
          
          results.push({
            subscription_id: subscription.subscription_id,
            processing_id: subscription.processing_id,
            status: processingResult.status,
            error: processingResult.error
          });
        } catch (error) {
          this.logger.error(`Error processing subscription ${subscription.subscription_id}`, {
            error: error.message,
            stack: error.stack
          });
          
          results.push({
            subscription_id: subscription.subscription_id,
            processing_id: subscription.processing_id,
            status: 'error',
            error: error.message
          });
          
          // Update status to error
          try {
            await client.query(`
              UPDATE subscription_processing
              SET status = 'failed', error = $2, updated_at = NOW()
              WHERE id = $1
            `, [subscription.processing_id, error.message]);
          } catch (updateError) {
            this.logger.error(`Error updating processing status for ${subscription.subscription_id}`, {
              error: updateError.message
            });
          }
        }
      }
      
      this.logger.info('Batch processing completed', {
        total: pendingSubscriptions.length,
        success: results.filter(r => r.status === 'success').length,
        errors: results.filter(r => r.status === 'error').length
      });
      
      return {
        status: 'success',
        processed: pendingSubscriptions.length,
        success_count: results.filter(r => r.status === 'success').length,
        error_count: results.filter(r => r.status === 'error').length,
        subscriptions: results
      };
    } catch (error) {
      this.logger.error('Error in batch subscription processing', {
        error: error.message,
        stack: error.stack
      });
      
      return {
        status: 'error',
        error: error.message
      };
    } finally {
      if (client) {
        client.release();
      }
    }
  }
}

module.exports = SubscriptionProcessor;