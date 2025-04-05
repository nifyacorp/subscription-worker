const { getLogger } = require('../config/logger');

class NotificationRepository {
    constructor(pool) {
        if (!pool) {
            throw new Error('NotificationRepository requires a database pool.');
        }
        this.pool = pool;
        this.logger = getLogger('notification-repository');
    }

    /**
     * Creates a new notification in the database.
     * @param {Object} notificationData - Data for the new notification.
     * @param {string} notificationData.user_id
     * @param {string} notificationData.subscription_id
     * @param {string} notificationData.title
     * @param {string} notificationData.content
     * @param {string} notificationData.source_url
     * @param {Object} notificationData.metadata
     * @param {string} notificationData.entity_type
     * @param {Date} [notificationData.created_at] - Optional creation date, defaults to NOW()
     * @returns {Promise<Object>} The created notification object (including its ID).
     */
    async create(notificationData) {
        const { 
            user_id, subscription_id, title, content, 
            source_url, metadata, entity_type, created_at 
        } = notificationData;

        this.logger.debug('Creating notification', { 
            user_id: user_id, 
            subscription_id: subscription_id, 
            title: title ? title.substring(0, 50) + '...' : '', // Log truncated title 
            entity_type: entity_type
        });

        try {
            const result = await this.pool.query(
                `INSERT INTO notifications (
                  user_id,
                  subscription_id,
                  title,
                  content,
                  source_url,
                  metadata,
                  entity_type,
                  created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id, user_id, subscription_id, title, content, source_url, metadata, entity_type, created_at`, // Return the full created row
                [
                  user_id,
                  subscription_id,
                  title,
                  content,
                  source_url || '',
                  JSON.stringify(metadata || {}),
                  entity_type,
                  created_at || new Date() // Use provided date or default to now
                ]
            );

            if (result.rowCount === 0) {
                this.logger.error('Failed to insert notification, no rows returned.', { user_id, subscription_id });
                throw new Error('Notification creation failed in DB.');
            }

            this.logger.info('Successfully created notification', { notification_id: result.rows[0].id, user_id, subscription_id });
            return result.rows[0]; // Return the created notification object

        } catch (error) {
            this.logger.error('Error creating notification in database', {
                user_id: user_id,
                subscription_id: subscription_id,
                error: error.message,
                code: error.code,
                // Avoid logging potentially large content/metadata here unless necessary for debugging
            });
            throw error; // Re-throw for the service layer
        }
    }

    // Add other methods as needed, e.g.:
    // async findById(notificationId) { ... }
    // async findByUserId(userId, options) { ... }
    // async markAsRead(notificationId) { ... }
}

module.exports = NotificationRepository; 