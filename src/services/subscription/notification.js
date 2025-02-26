const { getLogger } = require('../../config/logger');
const { publishEmailNotification } = require('../../config/pubsub');

const logger = getLogger('subscription-notification');

class NotificationService {
  constructor(pool) {
    this.pool = pool;
    this.logger = logger;
  }

  async createNotifications(client, subscription, matches) {
    const notificationValues = matches.map(match => ({
      user_id: subscription.user_id,
      subscription_id: subscription.subscription_id,
      title: `${subscription.type_name} Match: ${match.title || 'New match found'}`,
      content: match.summary || 'Content match found',
      source_url: match.links?.html || '',
      metadata: {
        match_type: subscription.type_name,
        relevance_score: match.relevance_score,
        prompt: match.prompt
      }
    }));

    const createdNotifications = [];

    for (const notification of notificationValues) {
      // Insert notification into database
      const result = await client.query(`
        INSERT INTO notifications (
          user_id,
          subscription_id,
          title,
          content,
          source_url,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        notification.user_id,
        notification.subscription_id,
        notification.title,
        notification.content,
        notification.source_url,
        notification.metadata
      ]);
      
      // Get the ID of the created notification
      const notificationId = result.rows[0].id;
      createdNotifications.push({
        ...notification,
        id: notificationId
      });
    }

    this.logger.debug({
      notifications_created: notificationValues.length
    }, 'Created notifications for matches');
    
    // After storing notifications in the database, publish to email service if applicable
    await this.publishNotificationsToEmailService(client, subscription, createdNotifications);
    
    return createdNotifications;
  }
  
  /**
   * Publish notifications to the email service based on user's notification preferences
   * @param {Object} client - Database client
   * @param {Object} subscription - Subscription data
   * @param {Array} notifications - Array of created notifications
   */
  async publishNotificationsToEmailService(client, subscription, notifications) {
    if (!notifications || notifications.length === 0) {
      return;
    }
    
    try {
      // Get user's notification settings
      const userResult = await client.query(`
        SELECT 
          id, 
          email, 
          notification_settings->>'emailNotifications' as email_notifications,
          notification_settings->>'notificationEmail' as notification_email,
          notification_settings->>'frequency' as frequency
        FROM users
        WHERE id = $1
      `, [subscription.user_id]);
      
      if (userResult.rows.length === 0) {
        this.logger.warn({
          user_id: subscription.user_id,
          subscription_id: subscription.subscription_id
        }, 'User not found for notification email');
        return;
      }
      
      const user = userResult.rows[0];
      
      // Check if email notifications are enabled
      if (user.email_notifications !== 'true') {
        this.logger.debug({
          user_id: user.id,
          subscription_id: subscription.subscription_id
        }, 'Email notifications disabled for user');
        return;
      }
      
      // Get more subscription details
      const subscriptionResult = await client.query(`
        SELECT id, name, type_id
        FROM subscriptions
        WHERE id = $1
      `, [subscription.subscription_id]);
      
      const subscriptionDetails = subscriptionResult.rows[0] || subscription;
      
      // Publish each notification to the email service
      const frequency = user.frequency || 'immediate';
      
      for (const notification of notifications) {
        await publishEmailNotification(
          notification,
          user,
          subscriptionDetails,
          frequency
        );
        
        this.logger.info({
          notification_id: notification.id,
          user_id: user.id,
          subscription_id: subscription.subscription_id,
          frequency
        }, 'Published notification to email service');
      }
    } catch (error) {
      this.logger.error({
        error: error.message,
        stack: error.stack,
        subscription_id: subscription.subscription_id,
        user_id: subscription.user_id
      }, 'Failed to publish notifications to email service');
      
      // We don't throw the error here to prevent the entire transaction from failing
      // The notifications are already stored in the database
    }
  }
}

module.exports = NotificationService;