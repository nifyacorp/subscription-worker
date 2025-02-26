const createNotifications = async (subscription, matches) => {
  const logger = getLogger('subscription-processor');
  
  try {
    // Create the notification record in the database
    // ... existing code to create database entry ...
    
    // Skip the PubSub notification for now
    logger.info('Created notification in database, skipping email notification topics', {
      subscription_id: subscription.id,
      matches_count: matches.length
    });
    
    /*
    // Original code that publishes to PubSub
    if (subscription.notification_preference === 'immediate') {
      await pubsub.emailImmediateTopic.publish(...);
    } else {
      await pubsub.emailDailyTopic.publish(...);
    }
    */
    
    return {
      status: 'success',
      notification_created: true,
      notification_published: false  // Indicate that we didn't publish to PubSub
    };
  } catch (error) {
    logger.error('Failed to create notification', {
      error: error.message,
      stack: error.stack,
      subscription_id: subscription.id
    });
    throw error;
  }
}; 