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
      // Fall back to the default parser URL if not specified in subscription_types
    }
    
    // Configure the parser client with the correct URL from subscription_types
    if (subscription.parser_url) {
      await this.parserClient.updateBaseURL(subscription.parser_url);
      console.info('Using parser URL from subscription type', {
        subscription_id: subscription.id,
        parser_url: subscription.parser_url,
        type_name: subscription.type_name
      });
    } else {
      console.warn('Using default parser URL (no type-specific URL found)', {
        subscription_id: subscription.id
      });
    }
    
    // Create a standardized request according to the parser protocol
    // All parsers use the same protocol regardless of subscription type
    const requestData = {
      texts: prompts,
      metadata: {
        user_id: subscription.user_id,
        subscription_id: subscription.id
      },
      date: new Date().toISOString().split('T')[0] // Use today's date in ISO format
    };

    console.debug('Sending request to parser', { 
      subscription_id: subscription.id,
      parser_url: subscription.parser_url,
      type_name: subscription.type_name,
      prompts: prompts
    });
    
    // Send the request to the parser service
    const parserResult = await this.parserClient.send(requestData);

    console.info('Parser processing completed', { 
      subscription_id: subscription.id, 
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
  
  /** Validate and normalize prompts */
  _validatePrompts(prompts) {
    if (!prompts || (Array.isArray(prompts) && prompts.length === 0)) {
      console.warn('No prompts found in subscription, using defaults');
      return DEFAULT_PROMPTS;
    }
    
    // Handle different prompt formats
    if (typeof prompts === 'string') {
      try {
        // Try to parse JSON string
        const parsed = JSON.parse(prompts);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        // Single string as JSON object
        return [prompts];
      } catch (e) {
        // Not JSON, treat as a single string
        return [prompts];
      }
    }
    
    if (Array.isArray(prompts)) {
      // Filter out any non-string items and empty strings
      return prompts
        .filter(p => typeof p === 'string' && p.trim().length > 0)
        .map(p => p.trim());
    }
    
    // Fallback to defaults if none of the above worked
    console.warn('Could not parse prompts, using defaults');
    return DEFAULT_PROMPTS;
  }
  
  /** Create a notification title if one wasn't provided */
  _generateNotificationTitle(entry) {
    if (entry.title) {
      return entry.title;
    }
    
    if (entry.issuing_body && entry.document_type) {
      return `${entry.document_type} de ${entry.issuing_body}`;
    }
    
    if (entry.document_type) {
      return `Nuevo ${entry.document_type}`;
    }
    
    return 'Nueva publicación encontrada';
  }
  
  /** Handle creating and publishing notifications for matches */
  async _handleNotifications(subscription, matches, traceId) {
    if (!matches || matches.length === 0) {
      console.info('No matches to create notifications for', { subscription_id: subscription.id });
      return { created: 0, errors: 0 };
    }
    
    console.info('Creating notifications for matches', { 
      subscription_id: subscription.id, 
      match_count: matches.length 
    });
    
    const results = { created: 0, errors: 0 };
    
    for (const match of matches) {
      try {
        // Create the notification in the database
        const notification = await this.notificationRepository.createNotification({
          user_id: subscription.user_id,
          subscription_id: subscription.id,
          title: match.notification_title || match.title,
          content: match.summary,
          source_url: match.links?.html || '',
          metadata: {
            document_type: match.document_type,
            issuing_body: match.issuing_body,
            publication_date: match.publication_date,
            relevance_score: match.relevance_score,
            prompt: match.prompt,
            department: match.department,
            section: match.section,
            processing_trace_id: traceId
          }
        });
        
        console.debug('Created notification', { 
          notification_id: notification.id, 
          subscription_id: subscription.id
        });
        
        // Optionally publish to Pub/Sub if configured
        if (this.notificationClient && this.notificationClient.isEnabled) {
          try {
            await this.notificationClient.publishNotification({
              id: notification.id,
              user_id: subscription.user_id,
              subscription_id: subscription.id,
              title: notification.title,
              content: notification.content,
              source_url: notification.source_url,
              created_at: notification.created_at
            });
            
            console.debug('Published notification event', { 
              notification_id: notification.id 
            });
          } catch (pubsubError) {
            console.error('Failed to publish notification event', {
              notification_id: notification.id,
              error: pubsubError.message
            });
            // Don't fail the whole process if pub/sub fails
          }
        }
        
        results.created++;
      } catch (error) {
        console.error('Error creating notification for match', {
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
  
  /** Update subscription last check time */
  async _updateSubscriptionStatus(subscriptionId, traceId) {
    try {
      await this.subscriptionRepository.updateLastProcessed(subscriptionId);
      console.debug('Updated subscription last processed time', { subscription_id: subscriptionId });
    } catch (error) {
      console.error('Failed to update subscription last processed time', {
        subscription_id: subscriptionId,
        error: error.message
      });
      // Don't fail the whole process for this
    }
  }

  // TODO: Add method for batch processing if needed, e.g., processPendingSubscriptions
  async processPendingSubscriptions() {
      // This method would likely:
      // 1. Fetch pending subscription IDs from subscriptionRepository
      // 2. Loop through IDs, calling processSubscription for each
      // 3. Aggregate results
      console.warn('processPendingSubscriptions method is not fully implemented yet.');
      // Placeholder implementation
      return { status: 'pending', processed: 0, success_count: 0, error_count: 0 }; 
  }
}

module.exports = { SubscriptionService }; 