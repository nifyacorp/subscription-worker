/**
 * Repository for subscription data access
 */
class SubscriptionRepository {
    constructor(pool) {
        if (!pool) {
            throw new Error('SubscriptionRepository requires a database pool.');
        }
        this.pool = pool;
    }

    /**
     * Find a subscription by its ID.
     * @param {string} subscriptionId - The ID of the subscription.
     * @returns {Promise<Object|null>} The subscription object or null if not found.
     */
    async findById(subscriptionId) {
        console.debug('Finding subscription by ID', { subscription_id: subscriptionId });
        try {
            const result = await this.pool.query(
                `SELECT 
                  s.id, 
                  s.user_id, 
                  s.name, 
                  s.prompts,
                  s.frequency,
                  s.last_processed_at,
                  t.id as type_id,
                  t.name as type_name,
                  t.parser_url,
                  t.logo_url,
                  t.description as type_description
                FROM subscriptions s 
                JOIN subscription_types t ON t.id = s.type_id
                WHERE s.id = $1`,
                [subscriptionId]
            );
            
            if (result.rows.length === 0) {
                console.warn('No subscription found with ID', { subscription_id: subscriptionId });
                return null;
            }
            
            const subscription = result.rows[0];
            console.debug('Found subscription', { 
                subscription_id: subscription.id,
                user_id: subscription.user_id,
                type_id: subscription.type_id,
                type_name: subscription.type_name,
                has_parser_url: !!subscription.parser_url
            });
            
            return subscription;
        } catch (error) {
            console.error('Error finding subscription by ID', { 
                subscription_id: subscriptionId,
                error: error.message,
                code: error.code
            });
            throw error;
        }
    }

    /**
     * Update the last processed timestamp for a subscription.
     * @param {string} subscriptionId - The ID of the subscription to update.
     * @returns {Promise<void>}
     */
    async updateLastProcessed(subscriptionId) {
        try {
            await this.pool.query(
                `UPDATE subscriptions 
                SET last_processed_at = NOW()
                WHERE id = $1`,
                [subscriptionId]
            );
            console.debug('Updated subscription last_processed_at', { subscription_id: subscriptionId });
        } catch (error) {
            console.error('Error updating subscription last_processed_at', { 
                subscription_id: subscriptionId,
                error: error.message,
                code: error.code
            });
            throw error;
        }
    }

    /**
     * Find subscriptions that need processing.
     * @param {Object} options - Options for finding pending subscriptions.
     * @param {number} options.limit - Maximum number of subscriptions to return.
     * @param {string} options.frequency - Filter by frequency (e.g., 'daily', 'weekly').
     * @returns {Promise<Array>} List of subscription IDs that need processing.
     */
    async findPendingSubscriptions({ limit = 10, frequency = 'daily' } = {}) {
        try {
            // This query finds subscriptions that haven't been processed recently based on their frequency
            const result = await this.pool.query(
                `SELECT s.id, s.user_id, s.name, s.frequency, s.last_processed_at, 
                        t.id as type_id, t.name as type_name, t.parser_url
                 FROM subscriptions s
                 JOIN subscription_types t ON t.id = s.type_id
                 WHERE s.active = true
                 AND (
                     s.last_processed_at IS NULL
                     OR (
                         s.frequency = 'daily' AND s.last_processed_at < NOW() - INTERVAL '1 day'
                     )
                     OR (
                         s.frequency = 'weekly' AND s.last_processed_at < NOW() - INTERVAL '7 days'
                     )
                     OR (
                         s.frequency = 'monthly' AND s.last_processed_at < NOW() - INTERVAL '30 days'
                     )
                 )
                 -- For a specific frequency: AND s.frequency = $1
                 ORDER BY s.last_processed_at ASC NULLS FIRST
                 LIMIT $1`,
                [limit]
            );
            
            return result.rows;
        } catch (error) {
            console.error('Error finding pending subscriptions', { 
                error: error.message,
                code: error.code,
                limit,
                frequency
            });
            throw error;
        }
    }

    // Add other methods as needed, e.g.:
    // async findPendingProcessing() { ... }
    // async updateStatus(subscriptionId, status) { ... }
}

module.exports = { SubscriptionRepository }; 