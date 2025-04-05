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
    console.info('Retrieved subscription details', { subscription_id: subscriptionId });
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

    console.debug('Sending request to parser', { subscription_id: subscription.id });
    const parserResult = await this.parserClient.send(requestData);

    console.info('Parser processing completed', { subscription_id: subscription.id, status: parserResult.status });

    return parserResult;
  }

  /** Validate and normalize subscription prompts */
  _validatePrompts(prompts) {
    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
      console.warn('No valid prompts found, using defaults');
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
      console.info('No matches to create notifications for', { subscription_id: subscription.id });
      return { created: 0, errors: 0 };
    }

    let notificationsCreated = 0;
    let errors = 0;
    console.info('Starting notification creation process', { match_count: matches.length });

    for (const match of matches) {
      try {
        const notificationData = this._prepareNotificationData(subscription, match, traceId);
        
        // 1. Save to Database
        const savedNotification = await this.notificationRepository.create(notificationData);
        console.info('Saved notification to DB', { notification_id: savedNotification.id });
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
            console.info('Published notification event', { notification_id: savedNotification.id });
          } catch (publishError) {
            errors++; // Count publish error as a partial failure for this match
            console.warn('Failed to publish notification event', { error: publishError.message });
            // Decide if this should be a fatal error for the match or just logged
          }
        }
      } catch (dbError) {
        errors++;
        console.error('Failed to create notification in DB', { error: dbError.message });
        // Continue to next match
      }
    }
    
    console.info('Notification creation completed', { created: notificationsCreated, errors: errors });
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
      console.debug('Updated subscription last_processed_at', { subscription_id: subscriptionId });
    } catch (error) {
      // Log error but don't fail the entire operation just for the status update
      console.error('Failed to update subscription last_processed_at', { error: error.message });
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

module.exports = SubscriptionService; 