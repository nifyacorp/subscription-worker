const { PubSub } = require('@google-cloud/pubsub');

const NOTIFICATION_TOPIC = process.env.NOTIFICATION_TOPIC || 'subscription-notifications';

class NotificationClient {
    constructor(config = {}) {
        this.pubsub = null;
        this.notificationTopic = null;
        this.projectId = config.projectId || process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
        this.isEnabled = config.enabled !== false && !!this.projectId; // Enabled only if there's a projectId
        this.isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
        
        // Create a topic name - either from config, env var, or default
        this.topicName = config.topicName || NOTIFICATION_TOPIC;

        if (this.isEnabled) {
            try {
                this.pubsub = new PubSub({ projectId: this.projectId });
                this.notificationTopic = this.pubsub.topic(this.topicName);
                console.info('PubSub Notification Client initialized', { 
                    project_id: this.projectId,
                    topic: this.topicName
                });
            } catch (error) {
                console.warn('Failed to initialize PubSub for notifications', { error: error.message });
                this.isEnabled = false;
                // Set up mock publisher for development
                if (this.isDevelopment) {
                    console.info('Using mock PubSub client for development');
                }
            }
        } else {
            console.info('PubSub Notification Client is disabled or missing Project ID', {
                development_mode: this.isDevelopment
            });
            
            if (this.isDevelopment) {
                console.info('Using mock PubSub client for development');
            }
        }
    }

    /**
     * Publishes a notification event.
     * @param {Object} notificationData - The notification data to publish.
     * @returns {Promise<string|null>} The message ID if published successfully, null otherwise.
     */
    async publish(notificationData) {
        // Check if we have real pubsub configured
        if (this.isEnabled && this.notificationTopic) {
            return this._publishToPubSub(notificationData);
        } else if (this.isDevelopment) {
            // Mock publishing for development
            return this._mockPublish(notificationData);
        } else {
            console.debug('Notification publishing is disabled and not in development mode, skipping.');
            return null;
        }
    }
    
    /**
     * Alias for publish to maintain backward compatibility
     */
    async publishNotification(notificationData) {
        return this.publish(notificationData);
    }
    
    /**
     * Publish notification to actual PubSub
     * @private
     */
    async _publishToPubSub(notificationData) {
        const notificationId = notificationData.id || notificationData.notification_id || 'unknown';
        const userId = notificationData.user_id || 'unknown';

        console.debug('Publishing notification event to PubSub', { notification_id: notificationId });

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
    
    /**
     * Mock implementation for development/testing
     * @private
     */
    async _mockPublish(notificationData) {
        const notificationId = notificationData.id || notificationData.notification_id || 'unknown';
        const userId = notificationData.user_id || 'unknown';
        const mockMessageId = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        
        console.info('MOCK: Publishing notification event', { 
            notification_id: notificationId,
            user_id: userId,
            message_id: mockMessageId,
            data: notificationData
        });
        
        return mockMessageId;
    }
}

module.exports = NotificationClient; 