const { getLogger } = require('../config/logger');

class SubscriptionRepository {
    constructor(pool) {
        if (!pool) {
            throw new Error('SubscriptionRepository requires a database pool.');
        }
        this.pool = pool;
        this.logger = getLogger('subscription-repository');
    }

    /**
     * Find a subscription by its ID.
     * @param {string} subscriptionId - The ID of the subscription.
     * @returns {Promise<Object|null>} The subscription object or null if not found.
     */
    async findById(subscriptionId) {
        this.logger.debug('Finding subscription by ID', { subscription_id: subscriptionId });
        try {
            const result = await this.pool.query(
                `SELECT 
                  id, 
                  user_id, 
                  name, 
                  type, 
                  metadata, 
                  prompts,
                  date_range, -- Assuming 'type' corresponds to subscription type, adjust if needed
                  notification_preference,
                  created_at, 
                  updated_at, 
                  last_processed_at
                  -- Add type_id, active, frequency, last_check_at if they are part of the core subscription model needed by the service
                  -- Example: s.type_id, s.active, s.frequency, s.last_check_at
                FROM subscriptions s 
                -- Potentially JOIN subscription_types st ON st.id = s.type_id if type name is needed
                WHERE s.id = $1`,
                [subscriptionId]
            );
            
            if (result.rowCount === 0) {
                this.logger.warn('Subscription not found', { subscription_id: subscriptionId });
                return null;
            }
            
            return result.rows[0];
        } catch (error) {
            this.logger.error('Error retrieving subscription by ID', {
                subscription_id: subscriptionId,
                error: error.message,
                code: error.code
            });
            throw error; // Re-throw the error to be handled by the service layer
        }
    }

    /**
     * Update the last_processed_at timestamp for a subscription.
     * @param {string} subscriptionId - The ID of the subscription to update.
     * @returns {Promise<boolean>} True if update was successful, false otherwise.
     */
    async updateLastProcessed(subscriptionId) {
        this.logger.debug('Updating subscription last_processed_at', { subscription_id: subscriptionId });
        try {
            const result = await this.pool.query(
                `UPDATE subscriptions
                 SET last_processed_at = NOW(),
                     updated_at = NOW()
                 WHERE id = $1`,
                [subscriptionId]
            );
            
            return result.rowCount > 0;
        } catch (error) {
            this.logger.error('Failed to update subscription last_processed_at', {
                subscription_id: subscriptionId,
                error: error.message,
                code: error.code
            });
            // Decide whether to throw or return false based on desired service behavior
            throw error; 
        }
    }

    // Add other methods as needed, e.g.:
    // async findPendingProcessing() { ... }
    // async updateStatus(subscriptionId, status) { ... }
}

module.exports = SubscriptionRepository; 