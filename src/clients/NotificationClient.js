const { getLogger } = require('../config/logger');
const { PubSub } = require('@google-cloud/pubsub');

const NOTIFICATION_TOPIC = process.env.NOTIFICATION_TOPIC || 'subscription-notifications';

class NotificationClient {
    constructor(config) {
        this.logger = getLogger('notification-client');
        this.pubsub = null;
        this.notificationTopic = null;
        this.projectId = config.projectId || process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
        this.isEnabled = config.enabled !== false; // Enabled by default

        if (this.isEnabled && this.projectId) {
            try {
                this.pubsub = new PubSub({ projectId: this.projectId });
                this.notificationTopic = this.pubsub.topic(NOTIFICATION_TOPIC);
                this.logger.info('PubSub Notification Client initialized', {
                    project_id: this.projectId,
                    topic: NOTIFICATION_TOPIC
                });
            } catch (error) {
                this.logger.warn('Failed to initialize PubSub for notifications', {
                    error: error.message,
                    project_id: this.projectId,
                    topic: NOTIFICATION_TOPIC
                });
                // Optionally disable if init fails, or let publish attempts handle it
                this.isEnabled = false; 
            }
        } else {
            this.logger.info('PubSub Notification Client is disabled or missing Project ID.');
            this.isEnabled = false;
        }
    }

    /**
     * Publishes a notification event.
     * @param {Object} notificationData - The notification data to publish.
     * @returns {Promise<string|null>} The message ID if published successfully, null otherwise.
     */
    async publishNotification(notificationData) {
        if (!this.isEnabled || !this.notificationTopic) {
            this.logger.debug('Notification publishing is disabled or not initialized, skipping.');
            return null;
        }

        const notificationId = notificationData.id || 'unknown';
        const userId = notificationData.user_id || 'unknown';
        const traceId = notificationData.trace_id || 'N/A';

        this.logger.debug('Publishing notification event', { notification_id: notificationId, user_id: userId, trace_id: traceId });

        try {
            const messageBuffer = Buffer.from(JSON.stringify(notificationData));
            const messageId = await this.notificationTopic.publishMessage({ data: messageBuffer });
            
            this.logger.info('Successfully published notification to PubSub', {
                notification_id: notificationId,
                user_id: userId,
                message_id: messageId,
                trace_id: traceId
            });
            return messageId;
        } catch (error) {
            this.logger.error('Failed to publish notification event to PubSub', {
                notification_id: notificationId,
                user_id: userId,
                error: error.message,
                code: error.code,
                trace_id: traceId
            });
            // Do not re-throw, allow the service to continue if publishing fails
            return null; 
        }
    }
}

module.exports = NotificationClient; 