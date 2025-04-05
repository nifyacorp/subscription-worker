/**
 * Subscription Processor Service
 * 
 * Handles the processing of subscriptions, coordinating with the parser
 * services and creating notifications based on the results.
 */

const axios = require('axios');
const crypto = require('crypto');
const { ParserClient } = require('../utils/parser-protocol');
const { getLogger } = require('../config/logger');
const { PubSub } = require('@google-cloud/pubsub');

// Constants
const NOTIFICATION_TOPIC = process.env.NOTIFICATION_TOPIC || 'subscription-notifications';
const DEFAULT_PROMPTS = ['Información general', 'Noticias importantes'];
const DEFAULT_MATCH_LIMIT = 10;

/**
 * SubscriptionProcessor class for handling subscription processing
 */
class SubscriptionProcessor {
  /**
   * Create a new SubscriptionProcessor
   * @param {Object} pool - Database connection pool
   * @param {string} [parserApiKey] - API key for the parser service
   */
  constructor(pool, parserApiKey) {
    this.pool = pool;
    this.parserApiKey = parserApiKey;
    this.logger = getLogger('subscription-processor');
    this.pubsub = null;
    
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
    
    // Configure parser base URL from environment or use default
    this.parserBaseUrl = process.env.PARSER_BASE_URL || 'https://boe-parser-415554190254.us-central1.run.app';
    
    this.logger.info('Subscription processor initialized', {
      parser_url: this.parserBaseUrl,
      api_key_present: !!this.parserApiKey,
      pubsub_initialized: !!this.pubsub
    });
  }
  
  /**
   * Process a single subscription by ID
   * @param {string} subscriptionId - The ID of the subscription to process
   * @returns {Promise<Object>} Processing result
   */
  async processSubscription(subscriptionId) {
    const traceId = crypto.randomBytes(8).toString('hex');
    
    this.logger.info('Processing subscription', {
      subscription_id: subscriptionId,
      trace_id: traceId
    });
    
    try {
      // Validate input
      if (!subscriptionId) {
        throw new Error('Invalid subscription ID');
      }
      
      // Check if the database pool is available
      if (!this.pool) {
        throw new Error('Database connection not available');
      }
      
      // Get the subscription details from the database
      const subscription = await this.getSubscription(subscriptionId);
      
      if (!subscription) {
        throw new Error(`Subscription not found: ${subscriptionId}`);
      }
      
      this.logger.info('Retrieved subscription details', {
        subscription_id: subscriptionId,
        user_id: subscription.user_id,
        prompts_count: subscription.prompts?.length || 0,
        subscription_type: subscription.type,
        trace_id: traceId
      });
      
      // Ensure we have valid prompts
      const prompts = this.validatePrompts(subscription.prompts);
      
      // Create a parser client
      const parserClient = new ParserClient({
        baseURL: this.parserBaseUrl,
        apiKey: this.parserApiKey,
        type: 'boe',
        logger: this.logger
      });
      
      // Process the subscription with the parser
      const requestData = parserClient.createRequest(
        prompts,
        subscription.user_id,
        subscriptionId,
        {
          limit: subscription.match_limit || DEFAULT_MATCH_LIMIT,
          date: new Date().toISOString().split('T')[0]
        }
      );
      
      // Send the request to the parser
      const parserResult = await parserClient.send(requestData);
      
      this.logger.info('Parser processing completed', {
        subscription_id: subscriptionId,
        entries_count: parserResult.entries?.length || 0,
        status: parserResult.status,
        trace_id: traceId
      });
      
      // Process the results to create notifications
      const matches = this.processResults(parserResult, prompts);
      
      // Create notifications for each match
      const notificationResult = await this.createNotifications(subscription, matches, traceId);
      
      // Update the subscription to indicate it was processed
      await this.updateSubscriptionLastProcessed(subscriptionId);
      
      this.logger.info('Subscription processing completed', {
        subscription_id: subscriptionId,
        notifications_created: notificationResult.created,
        errors: notificationResult.errors,
        trace_id: traceId
      });
      
      return {
        status: 'success',
        subscription_id: subscriptionId,
        matches_count: matches.length,
        notifications_created: notificationResult.created,
        trace_id: traceId
      };
    } catch (error) {
      this.logger.error('Error processing subscription', {
        subscription_id: subscriptionId,
        error: error.message,
        stack: error.stack,
        trace_id: traceId
      });
      
      return {
        status: 'error',
        error: error.message,
        subscription_id: subscriptionId,
        trace_id: traceId
      };
    }
  }
  
  /**
   * Get a subscription by ID from the database
   * @param {string} subscriptionId - The ID of the subscription to retrieve
   * @returns {Promise<Object|null>} The subscription details
   */
  async getSubscription(subscriptionId) {
    try {
      const result = await this.pool.query(
        `SELECT 
          id, 
          user_id, 
          name, 
          type, 
          metadata, 
          prompts,
          date_range,
          notification_preference,
          created_at, 
          updated_at, 
          last_processed_at
        FROM subscriptions
        WHERE id = $1`,
        [subscriptionId]
      );
      
      if (result.rowCount === 0) {
        this.logger.warn(`Subscription not found: ${subscriptionId}`);
        return null;
      }
      
      return result.rows[0];
    } catch (error) {
      this.logger.error('Error retrieving subscription', {
        subscription_id: subscriptionId,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Validate and normalize subscription prompts
   * @param {Array} prompts - The prompts from the subscription
   * @returns {Array<string>} Validated prompts
   */
  validatePrompts(prompts) {
    // If we have no prompts or invalid prompts, use defaults
    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
      this.logger.warn('No valid prompts found, using defaults');
      return DEFAULT_PROMPTS;
    }
    
    // Filter out invalid prompts and normalize
    return prompts
      .filter(prompt => typeof prompt === 'string' && prompt.trim().length > 0)
      .map(prompt => prompt.trim())
      .filter(prompt => prompt.length >= 3); // Minimum 3 chars
  }
  
  /**
   * Process parser results to create a standardized match format
   * @param {Object} parserResult - The result from the parser
   * @param {Array<string>} prompts - The original prompts
   * @returns {Array<Object>} Formatted matches
   */
  processResults(parserResult, prompts) {
    // No results or error
    if (!parserResult || parserResult.status === 'error' || !Array.isArray(parserResult.entries)) {
      this.logger.warn('No valid parser results', {
        status: parserResult?.status || 'unknown',
        error: parserResult?.error
      });
      return [];
    }
    
    // Process the entries
    const matches = parserResult.entries
      .filter(entry => entry && typeof entry === 'object')
      .map(entry => {
        // Ensure we have a prompt - use the first one if not specified
        const prompt = entry.prompt || prompts[0] || 'Información general';
        
        // Return a standardized format
        return {
          document_type: entry.document_type || 'generic',
          title: entry.title || 'Documento sin título',
          notification_title: entry.notification_title || this.generateTitle(entry),
          issuing_body: entry.issuing_body || entry.department || '',
          summary: entry.summary || entry.content || 'Sin contenido',
          relevance_score: entry.relevance_score || 0,
          prompt: prompt,
          links: entry.links || {},
          publication_date: entry.dates?.publication_date || new Date().toISOString().split('T')[0],
          department: entry.department || '',
          section: entry.section || ''
        };
      });
      
    this.logger.debug('Processed parser results', {
      entries_count: parserResult.entries.length,
      valid_matches: matches.length
    });
    
    return matches;
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
    return `Alerta BOE: ${new Date().toLocaleDateString()}`;
  }
  
  /**
   * Create notifications for a subscription based on matches
   * @param {Object} subscription - The subscription data
   * @param {Array<Object>} matches - The matches from the parser
   * @param {string} traceId - Trace ID for this processing operation
   * @returns {Promise<Object>} Result of notification creation
   */
  async createNotifications(subscription, matches, traceId) {
    if (!matches || matches.length === 0) {
      this.logger.info('No matches to create notifications for', {
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        trace_id: traceId
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
      match_count: matches.length,
      trace_id
    });
    
    // Process each match and create notifications
    for (const match of matches) {
      try {
        // Generate a meaningful title for the notification
        const notificationTitle = match.notification_title || this.generateTitle(match);
        
        // Create entity_type for metadata
        const entityType = `boe:${match.document_type?.toLowerCase() || 'document'}`;
        
        // Insert the notification into the database
        const result = await this.pool.query(
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
            match.summary,
            match.links?.html || '',
            JSON.stringify({
              prompt: match.prompt,
              relevance: match.relevance_score,
              document_type: match.document_type,
              original_title: match.title,
              publication_date: match.publication_date,
              issuing_body: match.issuing_body,
              section: match.section,
              department: match.department,
              trace_id: traceId
            }),
            entityType,
            new Date()
          ]
        );
        
        this.logger.info('Created notification', {
          user_id,
          subscription_id,
          notification_id: result.rows[0]?.id,
          title: notificationTitle,
          document_type: match.document_type,
          entity_type: entityType,
          trace_id
        });
        
        notificationsCreated++;
        
        // If we have PubSub configured, publish the notification for real-time updates
        if (this.pubsub && this.notificationTopic) {
          try {
            const notificationData = {
              id: result.rows[0]?.id,
              user_id,
              subscription_id,
              title: notificationTitle,
              content: match.summary,
              document_type: match.document_type,
              entity_type: entityType,
              source_url: match.links?.html || '',
              created_at: new Date().toISOString()
            };
            
            const messageId = await this.notificationTopic.publish(
              Buffer.from(JSON.stringify(notificationData))
            );
            
            this.logger.info('Published notification to PubSub', {
              notification_id: result.rows[0]?.id,
              user_id,
              message_id: messageId,
              trace_id
            });
          } catch (pubsubError) {
            this.logger.warn('Failed to publish notification to PubSub', {
              error: pubsubError.message,
              notification_id: result.rows[0]?.id,
              user_id,
              trace_id
            });
            // Non-blocking - we continue even if PubSub fails
          }
        }
      } catch (error) {
        errors++;
        this.logger.error('Failed to create notification', {
          user_id,
          subscription_id,
          error: error.message,
          error_code: error.code,
          stack: error.stack?.substring(0, 500) || 'No stack trace',
          title: match.notification_title || match.title,
          trace_id
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
        `${Math.round((notificationsCreated / (notificationsCreated + errors)) * 100)}%` : '0%',
      trace_id
    });
    
    return { created: notificationsCreated, errors };
  }
  
  /**
   * Update the last_processed_at timestamp for a subscription
   * @param {string} subscriptionId - The ID of the subscription to update
   * @returns {Promise<boolean>} Whether the update was successful
   */
  async updateSubscriptionLastProcessed(subscriptionId) {
    try {
      await this.pool.query(
        `UPDATE subscriptions
         SET last_processed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [subscriptionId]
      );
      
      this.logger.debug('Updated subscription last_processed_at', {
        subscription_id: subscriptionId
      });
      
      return true;
    } catch (error) {
      this.logger.error('Failed to update subscription last_processed_at', {
        subscription_id: subscriptionId,
        error: error.message
      });
      
      return false;
    }
  }
}

module.exports = SubscriptionProcessor;