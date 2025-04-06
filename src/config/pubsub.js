const { PubSub } = require('@google-cloud/pubsub');
const { getSecret } = require('./secrets');

// Check if running in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

// Initialize PubSub client only in production
let pubsub;
if (!isDevelopment) {
  pubsub = new PubSub();
}

// Topic names (will be loaded from environment or secrets)
let emailImmediateTopic;
let emailDailyTopic;
let notificationTopic;
let dlqTopic;

/**
 * Initialize PubSub configuration by loading topic names from secrets
 */
const initializePubSub = async () => {
  console.info('Initializing PubSub configuration');
  
  try {
    // Create PubSub client
    const pubSubClient = new PubSub({
      projectId: process.env.PROJECT_ID,
    });
    
    // Get topic names from environment variables with fallbacks to defaults
    const notificationTopicName = process.env.PUBSUB_TOPIC_NAME || 'processor-results';
    const dlqTopicName = process.env.PUBSUB_DLQ_TOPIC_NAME || 'processor-results-dlq';
    
    notificationTopic = pubSubClient.topic(notificationTopicName);
    dlqTopic = pubSubClient.topic(dlqTopicName);
    
    console.info('PubSub client initialized with topics', {
      mode: process.env.NODE_ENV || 'development',
      notification_topic: notificationTopicName,
      dlq_topic: dlqTopicName
    });
    
    // Skip trying to access the email topics for now
    /*
    // Original code:
    const emailImmediateTopicName = await getSecret('EMAIL_IMMEDIATE_TOPIC_NAME');
    const emailDailyTopicName = await getSecret('EMAIL_DAILY_TOPIC_NAME');
    
    const emailImmediateTopic = pubSubClient.topic(emailImmediateTopicName);
    const emailDailyTopic = pubSubClient.topic(emailDailyTopicName);
    */
    
    return {
      pubSubClient,
      notificationTopic,
      dlqTopic,
      // Not providing the email topics for now
      emailImmediateTopic: null,
      emailDailyTopic: null
    };
  } catch (error) {
    console.error('Failed to initialize PubSub configuration', {
      stack: error.stack,
      error: error.message
    });
    throw error;
  }
};

/**
 * Publish notification messages to the notification-worker service
 * This replaces the previous flow where the BOE Parser would publish directly
 * 
 * @param {Object} subscription - The subscription data 
 * @param {Array} matches - The matches found by the BOE parser
 * @param {string} processorType - The type of processor (e.g., 'boe')
 * @returns {Promise<string>} Message ID
 */
async function publishNotificationMessage(subscription, matches, processorType = 'boe') {
  if (!notificationTopic && !isDevelopment) {
    console.error('Notification topic not initialized');
    throw new Error('Notification topic not initialized. Call initializePubSub first.');
  }
  
  const subscriptionId = subscription.subscription_id || subscription.id;
  const userId = subscription.user_id;
  
  // Format the notification message similar to how the BOE parser would have done it
  const message = {
    version: '1.0',
    processor_type: processorType,
    timestamp: new Date().toISOString(),
    trace_id: generateTraceId(),
    request: {
      subscription_id: subscriptionId,
      processing_id: generateProcessingId(),
      user_id: userId,
      prompts: subscription.prompts || []
    },
    results: {
      query_date: new Date().toISOString().split('T')[0],
      matches: formatMatches(matches, subscription)
    },
    metadata: {
      processing_time_ms: 0, // We don't track this directly
      total_matches: matches.length,
      status: 'success',
      error: null
    }
  };
  
  // Validate the message before publishing
  const { validatePubSubNotification } = require('../utils/validation');
  const validationResult = validatePubSubNotification(message);
  
  if (!validationResult.valid) {
    console.warn('PubSub message validation warning', {
      errors: validationResult.errors,
      subscription_id: subscriptionId,
      processor_type: processorType
    });
    // We continue with the sanitized message even if validation fails
    // This ensures backward compatibility
  }
  
  // Log the notification message
  console.debug('Publishing notification message', {
    trace_id: message.trace_id,
    subscription_id: subscriptionId,
    user_id: userId,
    total_matches: matches.length,
    topic_name: process.env.PUBSUB_TOPIC_NAME || 'processor-results'
  });
  
  // In development mode, just log the message instead of publishing
  if (isDevelopment) {
    const mockMessageId = `dev-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.info({
      messageId: mockMessageId,
      subscription_id: subscriptionId,
      total_matches: matches.length,
      mode: 'development',
      topic: process.env.PUBSUB_TOPIC_NAME || 'processor-results'
    }, 'Development mode: Would have published notification message');
    
    // Log the first match for debugging
    if (matches.length > 0) {
      console.debug('First match sample', {
        match: JSON.stringify(matches[0]).substring(0, 500)
      });
    }
    
    return mockMessageId;
  }
  
  try {
    const dataBuffer = Buffer.from(JSON.stringify(message));
    
    // Use the notificationTopic that was initialized during startup
    const messageId = await notificationTopic.publish(dataBuffer);
    
    console.info({
      messageId,
      subscription_id: subscriptionId,
      total_matches: matches.length,
      topic: process.env.PUBSUB_TOPIC_NAME || 'processor-results'
    }, 'Published notification message to PubSub');
    
    return messageId;
  } catch (error) {
    console.error({
      error: error.message,
      stack: error.stack,
      subscription_id: subscriptionId,
      total_matches: matches.length,
      topic: process.env.PUBSUB_TOPIC_NAME || 'processor-results'
    }, 'Failed to publish notification message to PubSub');
    
    // Attempt to publish to DLQ if available
    if (dlqTopic && !isDevelopment) {
      try {
        // Add error information to the message
        const dlqMessage = {
          ...message,
          metadata: {
            ...message.metadata,
            error: error.message,
            original_topic: process.env.PUBSUB_TOPIC_NAME || 'processor-results',
            timestamp_error: new Date().toISOString(),
            status: 'error'
          }
        };
        
        const dlqBuffer = Buffer.from(JSON.stringify(dlqMessage));
        const dlqMessageId = await dlqTopic.publish(dlqBuffer);
        
        console.info({
          dlqMessageId,
          subscription_id: subscriptionId,
          error: error.message
        }, 'Published failed message to DLQ');
      } catch (dlqError) {
        console.error({
          error: dlqError.message,
          original_error: error.message,
          subscription_id: subscriptionId
        }, 'Failed to publish to DLQ');
      }
    }
    
    throw error;
  }
}

/**
 * Format matches into the expected structure for the notification worker
 * @param {Array} matches - The matches from the BOE parser
 * @param {Object} subscription - The subscription data
 * @returns {Array} Formatted matches
 */
function formatMatches(matches, subscription) {
  if (!matches || !Array.isArray(matches)) {
    return [];
  }
  
  // Group matches by prompt
  const matchesByPrompt = {};
  
  matches.forEach(match => {
    const prompt = match.prompt || 'default';
    if (!matchesByPrompt[prompt]) {
      matchesByPrompt[prompt] = [];
    }
    
    matchesByPrompt[prompt].push({
      document_type: 'boe_document',
      title: match.title || 'Unknown title',
      summary: match.summary || match.content || 'No summary available',
      relevance_score: match.relevance_score || 0.5,
      links: {
        html: match.links?.html || match.source_url || '',
        pdf: match.links?.pdf || ''
      },
      publication_date: match.publication_date || match.dates?.publication_date || new Date().toISOString(),
      section: match.section || '',
      bulletin_type: match.document_type || match.bulletin_type || 'OTHER'
    });
  });
  
  // Convert to expected array format
  return Object.entries(matchesByPrompt).map(([prompt, documents]) => ({
    prompt,
    documents
  }));
}

/**
 * Generate a unique trace ID
 * @returns {string} Trace ID
 */
function generateTraceId() {
  return `trace-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a unique processing ID
 * @returns {string} Processing ID
 */
function generateProcessingId() {
  return `proc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Publish a notification to the email service
 * @param {Object} notification - The notification data
 * @param {Object} user - User data including email
 * @param {Object} subscription - Subscription data
 * @param {string} frequency - 'immediate' or 'daily'
 * @returns {Promise<string>} Message ID
 */
async function publishEmailNotification(notification, user, subscription, frequency = 'immediate') {
  const topic = frequency === 'immediate' ? emailImmediateTopic : emailDailyTopic;
  
  if (!topic) {
    throw new Error(`PubSub topic for ${frequency} notifications not initialized`);
  }
  
  const message = {
    userId: user.id,
    email: user.email || user.notification_email,
    timestamp: new Date().toISOString(),
    notification: {
      id: notification.id,
      title: notification.title,
      content: notification.content,
      sourceUrl: notification.source_url,
      subscriptionId: subscription.id || subscription.subscription_id,
      subscriptionName: subscription.name || subscription.type_name || 'Subscription'
    }
  };
  
  // In development mode, just log the message instead of publishing
  if (isDevelopment) {
    const mockMessageId = `dev-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    logger.info({
      messageId: mockMessageId,
      topic,
      message,
      mode: 'development'
    }, 'Development mode: Would have published notification to email service');
    return mockMessageId;
  }
  
  try {
    const dataBuffer = Buffer.from(JSON.stringify(message));
    const messageId = await pubsub.topic(topic).publish(dataBuffer);
    
    logger.info({
      messageId,
      topic,
      notificationId: notification.id,
      userId: user.id
    }, 'Published notification to email service');
    
    return messageId;
  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      topic,
      notificationId: notification.id,
      userId: user.id
    }, 'Failed to publish notification to email service');
    
    throw error;
  }
}

module.exports = {
  initializePubSub,
  publishEmailNotification,
  publishNotificationMessage
}; 