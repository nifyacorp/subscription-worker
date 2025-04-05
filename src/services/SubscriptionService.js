/**
 * Subscription Service
 * 
 * Handles the core business logic for processing subscriptions,
 * coordinating with repositories, external clients (parser, pubsub),
 * and creating notifications.
 */

const crypto = require('crypto');
const { ParserClient } = require('../utils/parser-protocol'); // This path will be updated
const { getLogger } = require('../config/logger'); // This path will be updated

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
   * @param {Object} options.logger - Logger instance
   */
  constructor({ subscriptionRepository, notificationRepository, parserClient, notificationClient, logger }) {
    if (!subscriptionRepository || !notificationRepository || !parserClient || !logger) {
        throw new Error('Missing required dependencies for SubscriptionService');
    }
    this.subscriptionRepository = subscriptionRepository;
    this.notificationRepository = notificationRepository;
    this.parserClient = parserClient;
    this.notificationClient = notificationClient; // Optional: Can be null/undefined if not configured
    this.logger = logger || getLogger('subscription-service'); // Use injected logger or default
    
    this.logger.info('Subscription service initialized');
  }
  
  /**
   * Process a single subscription by ID
   * @param {string} subscriptionId - The ID of the subscription to process
   * @returns {Promise<Object>} Processing result with status, counts, and traceId
   */
  async processSubscription(subscriptionId) {
    const traceId = crypto.randomBytes(8).toString('hex');
    this.logger.info('Processing subscription', { subscription_id: subscriptionId, trace_id: traceId });

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
      
      this.logger.info('Subscription processing completed successfully', {
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
      this.logger.error('Subscription not found', { subscription_id: subscriptionId, trace_id: traceId });
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }
    this.logger.info('Retrieved subscription details', {
      subscription_id: subscriptionId,
      user_id: subscription.user_id,
      prompts_count: subscription.prompts?.length || 0,
      trace_id: traceId
    });
    return subscription;
  }

  /** Validate prompts and call the parser client */
  async _fetchParserResults(subscription, traceId) {
    const prompts = this._validatePrompts(subscription.prompts);
    
    const requestData = this.parserClient.createRequest(
      prompts,
      subscription.user_id,
      subscription.id,
      {
        limit: subscription.match_limit || DEFAULT_MATCH_LIMIT,
        date: new Date().toISOString().split('T')[0] // Consider making date configurable
      }
    );

    this.logger.debug('Sending request to parser', { subscription_id: subscription.id, trace_id: traceId });
    const parserResult = await this.parserClient.send(requestData);

    this.logger.info('Parser processing completed', {
      subscription_id: subscription.id,
      entries_count: parserResult.entries?.length || 0,
      status: parserResult.status,
      trace_id: traceId
    });

    return parserResult;
  }

  /** Validate and normalize subscription prompts */
  _validatePrompts(prompts) {
    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
      this.logger.warn('No valid prompts found, using defaults');
      return DEFAULT_PROMPTS;
    }
    
    const validated = prompts
      .filter(prompt => typeof prompt === 'string' && prompt.trim().length > 0)
      .map(prompt => prompt.trim())
      .filter(prompt => prompt.length >= 3); // Minimum 3 chars
      
    return validated.length > 0 ? validated : DEFAULT_PROMPTS;
  }
  
  /** Process parser entries into a standardized match format */
  _processParserEntries(parserResult, originalPrompts, traceId) {
    if (!parserResult || parserResult.status === 'error' || !Array.isArray(parserResult.entries)) {
      this.logger.warn('No valid parser results to process', {
        status: parserResult?.status || 'unknown',
        error: parserResult?.error,
        trace_id: traceId
      });
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
      
    this.logger.debug('Processed parser results into matches', {
      entries_count: parserResult.entries.length,
      valid_matches: matches.length,
      trace_id: traceId
    });
    
    return matches;
  }

  /** Generate a fallback notification title */
  _generateNotificationTitle(doc) {
     // Prefer explicit notification title
    if (doc.notification_title && typeof doc.notification_title === 'string' && doc.notification_title.length > 3 && !doc.notification_title.includes('notification')) {
      return doc.notification_title;
    }
    // Fallback to original title (truncated)
    if (doc.title && typeof doc.title === 'string' && doc.title.length > 3 && !doc.title.includes('notification')) {
      return doc.title.length > 80 ? doc.title.substring(0, 77) + '...' : doc.title;
    }
    // Construct title from type/issuer/date
    if (doc.document_type) {
      const docType = doc.document_type || 'Documento';
      const issuer = doc.issuing_body || doc.department || '';
      const date = doc.dates?.publication_date ? ` (${doc.dates.publication_date})` : '';
      return `${docType}${issuer ? ' de ' + issuer : ''}${date}`;
    }
    // Absolute fallback
    return `Alerta BOE: ${new Date().toLocaleDateString()}`;
  }
  
  /** Create notifications in the DB and publish events */
  async _handleNotifications(subscription, matches, traceId) {
    if (!matches || matches.length === 0) {
      this.logger.info('No matches to create notifications for', { subscription_id: subscription.id, trace_id: traceId });
      return { created: 0, errors: 0 };
    }

    let notificationsCreated = 0;
    let errors = 0;
    this.logger.info('Starting notification creation process', {
      subscription_id: subscription.id,
      match_count: matches.length,
      trace_id: traceId
    });

    for (const match of matches) {
      try {
        const notificationData = this._prepareNotificationData(subscription, match, traceId);
        
        // 1. Save to Database
        const savedNotification = await this.notificationRepository.create(notificationData);
        this.logger.info('Saved notification to DB', {
            notification_id: savedNotification.id,
            subscription_id: subscription.id,
            user_id: subscription.user_id,
            trace_id: traceId
        });
        notificationsCreated++;

        // 2. Publish Event (if client configured)
        if (this.notificationClient) {
          try {
             // Prepare data specifically for the event (might differ slightly from DB)
            const eventData = {
                id: savedNotification.id,
                user_id: savedNotification.user_id,
                subscription_id: savedNotification.subscription_id,
                title: savedNotification.title,
                content: savedNotification.content,
                document_type: match.document_type, // Get from original match if needed
                entity_type: notificationData.entity_type,
                source_url: notificationData.source_url,
                created_at: new Date(savedNotification.created_at).toISOString(),
                trace_id: traceId
            };
            await this.notificationClient.publishNotification(eventData);
            this.logger.info('Published notification event', { notification_id: savedNotification.id, trace_id: traceId });
          } catch (publishError) {
            errors++; // Count publish error as a partial failure for this match
            this.logger.warn('Failed to publish notification event', {
              error: publishError.message,
              notification_id: savedNotification.id,
              subscription_id: subscription.id,
              trace_id: traceId
            });
            // Decide if this should be a fatal error for the match or just logged
          }
        }
      } catch (dbError) {
        errors++;
        this.logger.error('Failed to create notification in DB', {
          subscription_id: subscription.id,
          user_id: subscription.user_id,
          error: dbError.message,
          error_code: dbError.code,
          stack: dbError.stack?.substring(0, 500),
          match_title: match.title,
          trace_id: traceId
        });
        // Continue to next match
      }
    }
    
    this.logger.info('Notification creation completed', {
      subscription_id: subscription.id,
      notifications_created: notificationsCreated,
      errors: errors,
      trace_id: traceId
    });
    return { created: notificationsCreated, errors };
  }

  /** Prepare data for inserting a notification */
  _prepareNotificationData(subscription, match, traceId) {
      const notificationTitle = match.notification_title; // Already generated
      const entityType = `boe:${match.document_type?.toLowerCase() || 'document'}`;

      return {
          user_id: subscription.user_id,
          subscription_id: subscription.id,
          title: notificationTitle,
          content: match.summary,
          source_url: match.links?.html || '',
          metadata: {
            prompt: match.prompt,
            relevance: match.relevance_score,
            document_type: match.document_type,
            original_title: match.title,
            publication_date: match.publication_date,
            issuing_body: match.issuing_body,
            section: match.section,
            department: match.department,
            trace_id: traceId
          },
          entity_type: entityType,
          created_at: new Date() // Repository might handle this
      };
  }
  
  /** Update the subscription's last processed timestamp */
  async _updateSubscriptionStatus(subscriptionId, traceId) {
    try {
      await this.subscriptionRepository.updateLastProcessed(subscriptionId);
      this.logger.debug('Updated subscription last_processed_at', { subscription_id: subscriptionId, trace_id: traceId });
    } catch (error) {
      // Log error but don't fail the entire operation just for the status update
      this.logger.error('Failed to update subscription last_processed_at', {
        subscription_id: subscriptionId,
        error: error.message,
        trace_id: traceId
      });
    }
  }

  // TODO: Add method for batch processing if needed, e.g., processPendingSubscriptions
  async processPendingSubscriptions() {
      // This method would likely:
      // 1. Fetch pending subscription IDs from subscriptionRepository
      // 2. Loop through IDs, calling processSubscription for each
      // 3. Aggregate results
      this.logger.warn('processPendingSubscriptions method is not fully implemented yet.');
      // Placeholder implementation
      return { status: 'pending', processed: 0, success_count: 0, error_count: 0 }; 
  }
}

module.exports = SubscriptionService; 