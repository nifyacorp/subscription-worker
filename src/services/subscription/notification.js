const { getLogger } = require('../../config/logger');

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

    for (const notification of notificationValues) {
      await client.query(`
        INSERT INTO notifications (
          user_id,
          subscription_id,
          title,
          content,
          source_url,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        notification.user_id,
        notification.subscription_id,
        notification.title,
        notification.content,
        notification.source_url,
        notification.metadata
      ]);
    }

    this.logger.debug({
      notifications_created: notificationValues.length
    }, 'Created notifications for matches');
  }
}

module.exports = NotificationService;