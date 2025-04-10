/**
 * Subscription Service
 * 
 * Handles the core business logic for processing subscriptions,
 * coordinating with repositories, external clients (parser, pubsub),
 * and creating notifications.
 */

const crypto = require('crypto');
const { ParserClient } = require('../utils/parser-protocol'); // This path will be updated

// Constants - these might move to config later
const DEFAULT_PROMPTS = ['Información general', 'Noticias importantes'];
const DEFAULT_MATCH_LIMIT = 10;

/**
 * SubscriptionService class for handling subscription processing logic
 */
class SubscriptionService {
  /**
   * Create a new SubscriptionService
   * @param {Object} options - Dependencies
   * @param {Object} options.subscriptionRepository - Repository for subscription data
   * @param {Object} options.notificationRepository - Repository for notification data
   * @param {Object} options.parserClient - Client for interacting with the parser service
   * @param {Object} options.notificationClient - Client for publishing notifications (e.g., PubSub)
   */
  constructor({ subscriptionRepository, notificationRepository, parserClient, notificationClient }) {
    if (!subscriptionRepository || !notificationRepository || !parserClient) {
        throw new Error('Missing required dependencies for SubscriptionService');
    }
    this.subscriptionRepository = subscriptionRepository;
    this.notificationRepository = notificationRepository;
    this.parserClient = parserClient;
    this.notificationClient = notificationClient;
    
    console.info('Subscription service initialized');
  }
  
  /**
   * Process a single subscription by ID
   * @param {string} subscriptionId - The ID of the subscription to process
   * @returns {Promise<Object>} Processing result with status, counts, and traceId
   */
  async processSubscription(subscriptionId) {
    const traceId = crypto.randomBytes(8).toString('hex');
    console.info('Processing subscription', { subscription_id: subscriptionId, trace_id: traceId });

    try {
      if (!subscriptionId) {
        throw new Error('Invalid subscription ID provided');
      }

      // 1. Fetch Subscription Data
      const subscription = await this._getSubscriptionData(subscriptionId, traceId);
      
      // Check if the subscription type has a parser URL
      if (!subscription.parser_url) {
        console.info('Skipping subscription with no parser URL', { 
          subscription_id: subscriptionId, 
          type_id: subscription.type_id,
          type_name: subscription.type_name || 'unknown',
          trace_id: traceId
        });
        
        return {
          status: 'skipped',
          subscription_id: subscriptionId,
          reason: 'no_parser_url',
          message: 'Subscription type has no parser URL configured',
          trace_id: traceId
        };
      }

      // 2. Get Parser Results
      const parserResult = await this._fetchParserResults(subscription, traceId);
      
      // 3. Process Results into Matches
      const matches = this._processParserEntries(parserResult, subscription.prompts, traceId);
      
      // 4. Create and Publish Notifications
      const notificationResult = await this._handleNotifications(subscription, matches, traceId);
      
      // 5. Update Subscription Status
      await this._updateSubscriptionStatus(subscriptionId, traceId);
      
      console.info('Subscription processing completed successfully', {
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
      console.error('Error processing subscription', {
        subscription_id: subscriptionId,
        error: error.message,
        stack: error.stack,
        trace_id: traceId
      });
      
      // Consider updating subscription status to 'error' here if appropriate
      
      return {
        status: 'error',
        error: error.message,
        subscription_id: subscriptionId,
        trace_id: traceId
      };
    }
  }

  // --- Private Helper Methods --- 

  /** Fetch subscription data */
  async _getSubscriptionData(subscriptionId, traceId) {
    console.debug('[DEBUG] Fetching subscription data', { 
      subscription_id: subscriptionId,
      trace_id: traceId
    });
    
    const subscription = await this.subscriptionRepository.findById(subscriptionId);
    if (!subscription) {
      console.error('Subscription not found', { subscription_id: subscriptionId });
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }
    
    console.info('Retrieved subscription details', { 
      subscription_id: subscriptionId,
      type_id: subscription.type_id,
      type_name: subscription.type_name,
      parser_url: subscription.parser_url || 'not specified'
    });
    
    // Additional debug logging for subscription type information
    console.debug('[DEBUG] Subscription type details', {
      subscription_id: subscriptionId,
      type: {
        id: subscription.type_id,
        name: subscription.type_name,
        parser_url: subscription.parser_url,
        description: subscription.type_description
      },
      trace_id: traceId
    });
    
    return subscription;
  }

  /** Validate prompts and call the parser client */
  async _fetchParserResults(subscription, traceId) {
    const prompts = this._validatePrompts(subscription.prompts);
    
    // Check if we have a parser URL from the subscription type
    if (!subscription.parser_url) {
      console.warn('No parser URL available for subscription type', { 
        subscription_id: subscription.id,
        type_name: subscription.type_name || 'unknown',
        type_id: subscription.type_id
      });
      throw new Error(`No parser URL configured for subscription type: ${subscription.type_id}`);
    }
    
    // Additional debug logging for parser selection based on subscription type
    console.debug('[DEBUG] Using parser based on subscription type', {
      subscription_id: subscription.id,
      type_name: subscription.type_name,
      type_id: subscription.type_id,
      parser_url: subscription.parser_url,
      trace_id: traceId
    });
    
    // Configure the parser client with the correct URL from subscription_types
    await this.parserClient.updateBaseURL(subscription.parser_url);
    console.info('Using parser URL from subscription type', {
      subscription_id: subscription.id,
      parser_url: subscription.parser_url,
      type_name: subscription.type_name
    });
    
    // Create a standardized request according to the parser protocol
    // All parsers use the same protocol regardless of subscription type
    const requestData = {
      texts: prompts,
      metadata: {
        user_id: subscription.user_id,
        subscription_id: subscription.id,
        type_id: subscription.type_id,
        type_name: subscription.type_name,
        trace_id: traceId
      },
      date: new Date().toISOString().split('T')[0] // Use today's date in ISO format
    };

    console.debug('Sending request to parser for subscription type', { 
      subscription_id: subscription.id,
      type_id: subscription.type_id,
      parser_url: subscription.parser_url,
      type_name: subscription.type_name,
      prompts: prompts
    });
    
    // Send the request to the parser service
    const parserResult = await this.parserClient.send(requestData);

    console.info('Parser processing completed', { 
      subscription_id: subscription.id,
      type_id: subscription.type_id,
      status: parserResult.status,
      entries_count: parserResult.entries?.length || 0 
    });

    return parserResult;
  }
  
  /** Process parser entries into a standardized match format */
  _processParserEntries(parserResult, originalPrompts, traceId) {
    if (!parserResult || parserResult.status === 'error' || !Array.isArray(parserResult.entries)) {
      console.warn('No valid parser results to process');
      return [];
    }
    
    const matches = parserResult.entries
      .filter(entry => entry && typeof entry === 'object')
      .map(entry => {
        const prompt = entry.prompt || (originalPrompts && originalPrompts[0]) || DEFAULT_PROMPTS[0];
        return {
          document_type: entry.document_type || 'generic',
          title: entry.title || 'Documento sin título',
          notification_title: entry.notification_title || this._generateNotificationTitle(entry),
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
      
    console.debug('Processed parser results into matches', { valid_matches: matches.length });
    
    return matches;
  }
  
  /** Validate and clean up prompts */
  _validatePrompts(prompts) {
    // Handle different prompt formats
    let cleanPrompts = prompts;
    
    // If prompts is a string, try to parse it as JSON
    if (typeof prompts === 'string') {
      try {
        cleanPrompts = JSON.parse(prompts);
      } catch (err) {
        // If it's not valid JSON, use it as a single prompt
        cleanPrompts = [prompts];
      }
    }
    
    // Ensure prompts is an array
    if (!Array.isArray(cleanPrompts)) {
      cleanPrompts = cleanPrompts ? [String(cleanPrompts)] : [];
    }
    
    // Filter out empty prompts and trim whitespace
    cleanPrompts = cleanPrompts
      .filter(prompt => prompt && typeof prompt === 'string' && prompt.trim().length > 0)
      .map(prompt => prompt.trim());
    
    // Use default prompts if none are provided
    if (cleanPrompts.length === 0) {
      console.warn('No valid prompts found, using defaults');
      return DEFAULT_PROMPTS;
    }
    
    return cleanPrompts;
  }
  
  /** Generate a notification title from a document */
  _generateNotificationTitle(document) {
    if (!document) return 'Nueva notificación';
    
    const title = document.title || '';
    if (title.length <= 60) return title;
    
    return title.substring(0, 57) + '...';
  }
  
  /** Create and publish notifications for matches */
  async _handleNotifications(subscription, matches, traceId) {
    if (!matches || matches.length === 0) {
      console.debug('No matches to create notifications for', {
        subscription_id: subscription.id
      });
      return { created: 0, errors: 0 };
    }
    
    console.info('Creating notifications for matches', {
      subscription_id: subscription.id,
      matches_count: matches.length
    });
    
    const results = {
      created: 0,
      errors: 0
    };
    
    for (const match of matches) {
      try {
        const notification = await this.notificationRepository.createNotification({
          subscription_id: subscription.id,
          user_id: subscription.user_id,
          title: match.notification_title || match.title,
          content: match.summary,
          source_url: match.links?.html || '',
          metadata: {
            document_type: match.document_type,
            publication_date: match.publication_date,
            prompt: match.prompt,
            relevance_score: match.relevance_score,
            trace_id: traceId
          }
        });
        
        // Try to publish to notification client if available
        if (this.notificationClient) {
          await this.notificationClient.publish({
            notification_id: notification.id,
            user_id: subscription.user_id,
            subscription_id: subscription.id,
            subscription_type: subscription.type_name,
            title: notification.title,
            trace_id: traceId
          });
        }
        
        results.created++;
      } catch (error) {
        console.error('Error creating notification', {
          subscription_id: subscription.id,
          error: error.message,
          match: {
            title: match.title,
            document_type: match.document_type
          }
        });
        results.errors++;
      }
    }
    
    return results;
  }
  
  /** Update subscription status after processing */
  async _updateSubscriptionStatus(subscriptionId, traceId) {
    try {
      await this.subscriptionRepository.updateLastProcessed(subscriptionId);
      console.debug('Updated subscription last processed timestamp', {
        subscription_id: subscriptionId
      });
    } catch (error) {
      console.warn('Failed to update subscription status', {
        subscription_id: subscriptionId,
        error: error.message
      });
      // Don't throw here, as this is just housekeeping
    }
  }

  // TODO: Add method for batch processing if needed, e.g., processPendingSubscriptions
  async processPendingSubscriptions() {
    console.info('Processing pending subscriptions...');
    try {
        // Get pending subscriptions for all types
        const pendingSubscriptions = await this.subscriptionRepository.findPendingSubscriptions();
        
        console.info(`Found ${pendingSubscriptions.length} pending subscriptions to process`);
        
        const results = {
            status: 'completed',
            processed: pendingSubscriptions.length,
            success_count: 0,
            error_count: 0,
            skipped_count: 0,
            by_type: {}
        };
        
        // Process each subscription
        for (const subscription of pendingSubscriptions) {
            try {
                const result = await this.processSubscription(subscription.id);
                const type_id = subscription.type_id || 'unknown';
                
                // Initialize type stats if not present
                if (!results.by_type[type_id]) {
                    results.by_type[type_id] = {
                        success: 0,
                        error: 0,
                        skipped: 0
                    };
                }
                
                if (result.status === 'success') {
                    results.success_count++;
                    results.by_type[type_id].success++;
                } else if (result.status === 'skipped') {
                    results.skipped_count++;
                    results.by_type[type_id].skipped++;
                } else {
                    results.error_count++;
                    results.by_type[type_id].error++;
                }
            } catch (error) {
                console.error('Error processing subscription in batch', {
                    subscription_id: subscription.id,
                    error: error.message
                });
                results.error_count++;
                
                const type_id = subscription.type_id || 'unknown';
                if (!results.by_type[type_id]) {
                    results.by_type[type_id] = { success: 0, error: 0, skipped: 0 };
                }
                results.by_type[type_id].error++;
            }
        }
        
        console.info('Completed processing pending subscriptions', results);
        return results;
    } catch (error) {
        console.error('Error processing pending subscriptions', {
            error: error.message,
            stack: error.stack
        });
        return {
            status: 'error',
            error: error.message,
            processed: 0,
            success_count: 0,
            error_count: 0,
            skipped_count: 0,
            by_type: {}
        };
    }
  }
}

module.exports = { SubscriptionService }; 