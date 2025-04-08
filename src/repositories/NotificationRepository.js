class NotificationRepository {
    constructor(pool) {
        if (!pool) {
            throw new Error('NotificationRepository requires a database pool.');
        }
        this.pool = pool;
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
     * @param {string} [notificationData.entity_type]
     * @param {Date} [notificationData.created_at] - Optional creation date, defaults to NOW()
     * @returns {Promise<Object>} The created notification object (including its ID).
     */
    async create(notificationData) {
        const { 
            user_id, subscription_id, title, content, 
            source_url, metadata, entity_type, created_at 
        } = notificationData;

        console.debug('Creating notification', { user_id: user_id, subscription_id: subscription_id });

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
                  entity_type || 'subscription', // Default to 'subscription' if not provided
                  created_at || new Date() // Use provided date or default to now
                ]
            );

            if (result.rowCount === 0) {
                console.error('Failed to insert notification, no rows returned.', { user_id, subscription_id });
                throw new Error('Notification creation failed in DB.');
            }

            console.info('Successfully created notification', { notification_id: result.rows[0].id });
            return result.rows[0]; // Return the created notification object

        } catch (error) {
            console.error('Error creating notification in database', { error: error.message });
            throw error; // Re-throw for the service layer
        }
    }

    /**
     * Creates a new notification from match data.
     * This method provides a simpler interface used by the SubscriptionService.
     * 
     * @param {Object} notificationData - Notification data with match information
     * @returns {Promise<Object>} The created notification
     */
    async createNotification(notificationData) {
        // Determine entity type based on document_type if available
        const documentType = notificationData.metadata?.document_type || 'document';
        const entityType = `${documentType.toLowerCase()}`;
        
        // Create standardized notification data
        return this.create({
            user_id: notificationData.user_id,
            subscription_id: notificationData.subscription_id,
            title: notificationData.title,
            content: notificationData.content,
            source_url: notificationData.source_url || '',
            metadata: notificationData.metadata || {},
            entity_type: entityType
        });
    }

    // Add other methods as needed, e.g.:
    // async findById(notificationId) { ... }
    // async findByUserId(userId, options) { ... }
    // async markAsRead(notificationId) { ... }
}

module.exports = { NotificationRepository }; 