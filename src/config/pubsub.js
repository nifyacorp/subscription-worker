const { PubSub } = require('@google-cloud/pubsub');
const { getLogger } = require('./logger');
const { getSecret } = require('./secrets');

const logger = getLogger('pubsub');

// Initialize PubSub client
const pubsub = new PubSub();

// Topic names (will be loaded from environment or secrets)
let emailImmediateTopic;
let emailDailyTopic;

/**
 * Initialize PubSub configuration by loading topic names from secrets
 */
async function initializePubSub() {
  logger.info('Initializing PubSub configuration');
  
  try {
    // Load topic names from secrets or use defaults
    emailImmediateTopic = await getSecret('EMAIL_IMMEDIATE_TOPIC_NAME') || 'email-notifications-immediate';
    emailDailyTopic = await getSecret('EMAIL_DAILY_TOPIC_NAME') || 'email-notifications-daily';
    
    logger.info({
      emailImmediateTopic,
      emailDailyTopic
    }, 'PubSub topics initialized');
    
    return {
      emailImmediateTopic,
      emailDailyTopic
    };
  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Failed to initialize PubSub configuration');
    
    // Use default values as fallback
    emailImmediateTopic = 'email-notifications-immediate';
    emailDailyTopic = 'email-notifications-daily';
    
    return {
      emailImmediateTopic,
      emailDailyTopic,
      error: error.message
    };
  }
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