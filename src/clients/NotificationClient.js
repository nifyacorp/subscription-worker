const { PubSub } = require('@google-cloud/pubsub');

const NOTIFICATION_TOPIC = process.env.NOTIFICATION_TOPIC || 'subscription-notifications';

class NotificationClient {
    constructor(config) {
        this.pubsub = null;
        this.notificationTopic = null;
        this.projectId = config.projectId || process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
        this.isEnabled = config.enabled !== false; // Enabled by default

        if (this.isEnabled && this.projectId) {
            try {
                this.pubsub = new PubSub({ projectId: this.projectId });
                this.notificationTopic = this.pubsub.topic(NOTIFICATION_TOPIC);
                console.info('PubSub Notification Client initialized', { project_id: this.projectId });
            } catch (error) {
                console.warn('Failed to initialize PubSub for notifications', { error: error.message });
                this.isEnabled = false; 
            }
        } else {
            console.info('PubSub Notification Client is disabled or missing Project ID.');
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
            console.debug('Notification publishing is disabled or not initialized, skipping.');
            return null;
        }

        const notificationId = notificationData.id || 'unknown';
        const userId = notificationData.user_id || 'unknown';
        const traceId = notificationData.trace_id || 'N/A';

        console.debug('Publishing notification event', { notification_id: notificationId });

        try {
            const messageBuffer = Buffer.from(JSON.stringify(notificationData));
            const messageId = await this.notificationTopic.publishMessage({ data: messageBuffer });
            
            console.info('Successfully published notification to PubSub', { message_id: messageId });
            return messageId;
        } catch (error) {
            console.error('Failed to publish notification event to PubSub', { error: error.message });
            return null; 
        }
    }
}

module.exports = NotificationClient; 