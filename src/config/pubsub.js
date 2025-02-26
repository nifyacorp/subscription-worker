const { PubSub } = require('@google-cloud/pubsub');
const { getLogger } = require('./logger');
const { getSecret } = require('./secrets');

const logger = getLogger('pubsub');

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

/**
 * Initialize PubSub configuration by loading topic names from secrets
 */
const initializePubSub = async () => {
  const logger = getLogger('pubsub');
  
  try {
    logger.info('Initializing PubSub configuration');
    
    // Create PubSub client
    const pubSubClient = new PubSub({
      projectId: process.env.PROJECT_ID,
    });
    
    // Skip trying to access the email topics for now
    /*
    // Original code:
    const emailImmediateTopicName = await getSecret('EMAIL_IMMEDIATE_TOPIC_NAME');
    const emailDailyTopicName = await getSecret('EMAIL_DAILY_TOPIC_NAME');
    
    const emailImmediateTopic = pubSubClient.topic(emailImmediateTopicName);
    const emailDailyTopic = pubSubClient.topic(emailDailyTopicName);
    */
    
    // Return a simpler configuration that doesn't need the topics
    logger.info('PubSub client initialized without email notification topics', {
      mode: process.env.NODE_ENV || 'development'
    });
    
    return {
      pubSubClient,
      // Not providing the email topics for now
      emailImmediateTopic: null,
      emailDailyTopic: null
    };
  } catch (error) {
    logger.error('Failed to initialize PubSub configuration', {
      stack: error.stack,
      error: error.message
    });
    throw error;
  }
};

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
  publishEmailNotification
}; 