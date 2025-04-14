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
            // Log before query execution for debugging
            console.debug('[DEBUG] Executing query to find subscription with type information', { 
                subscription_id: subscriptionId,
                query: `SELECT s.id, s.user_id, s.name, s.prompts, s.frequency, s.metadata,
                    t.id as type_id, t.name as type_name, t.parser_url, t.logo_url, t.description as type_description
                    FROM subscriptions s JOIN subscription_types t ON t.id = s.type_id WHERE s.id = $1`
            });
            
            const result = await this.pool.query(
                `SELECT 
                  s.id, 
                  s.user_id, 
                  s.name, 
                  s.prompts,
                  s.frequency,
                  s.metadata,
                  t.id as type_id,
                  t.name as type_name,
                  t.parser_url,
                  t.logo_url,
                  t.description as type_description,
                  t.metadata as type_metadata
                FROM subscriptions s 
                JOIN subscription_types t ON t.id = s.type_id
                WHERE s.id = $1`,
                [subscriptionId]
            );
            
            if (result.rows.length === 0) {
                console.warn('No subscription found with ID', { subscription_id: subscriptionId });
                
                // Try to get information about the subscription without joining type
                try {
                    const subResult = await this.pool.query(
                        `SELECT id, user_id, name, type_id FROM subscriptions WHERE id = $1`,
                        [subscriptionId]
                    );
                    
                    if (subResult.rows.length > 0) {
                        const sub = subResult.rows[0];
                        console.warn('[DEBUG] Found subscription but no matching type', {
                            subscription_id: sub.id,
                            type_id: sub.type_id
                        });
                        
                        // Try to get type information directly
                        try {
                            const typeResult = await this.pool.query(
                                `SELECT id, name FROM subscription_types WHERE id = $1`,
                                [sub.type_id]
                            );
                            
                            if (typeResult.rows.length === 0) {
                                console.error('[DEBUG] Subscription type not found in database', {
                                    subscription_id: sub.id,
                                    type_id: sub.type_id
                                });
                            }
                        } catch (typeError) {
                            console.error('[DEBUG] Error looking up subscription type', {
                                error: typeError.message,
                                type_id: sub.type_id
                            });
                        }
                    }
                } catch (subError) {
                    console.error('[DEBUG] Error looking up subscription details', {
                        error: subError.message
                    });
                }
                
                return null;
            }
            
            const subscription = result.rows[0];
            
            // Extract last_processed_at from metadata if it exists
            if (subscription.metadata && subscription.metadata.last_processed_at) {
                subscription.last_processed_at = subscription.metadata.last_processed_at;
            } else {
                subscription.last_processed_at = null;
            }
            
            console.debug('Found subscription', { 
                subscription_id: subscription.id,
                user_id: subscription.user_id,
                type_id: subscription.type_id,
                type_name: subscription.type_name,
                has_parser_url: !!subscription.parser_url,
                last_processed_at: subscription.last_processed_at
            });
            
            // Additional debug logging for subscription type details
            console.debug('[DEBUG] Subscription type details', {
                type_id: subscription.type_id,
                type_name: subscription.type_name,
                parser_url: subscription.parser_url || 'not specified',
                description: subscription.type_description || 'no description',
                metadata: subscription.type_metadata || {}
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
            const now = new Date().toISOString();
            await this.pool.query(
                `UPDATE subscriptions 
                SET metadata = jsonb_set(
                    COALESCE(metadata, '{}'), 
                    '{last_processed_at}', 
                    to_jsonb($2::text)
                ),
                updated_at = NOW()
                WHERE id = $1`,
                [subscriptionId, now]
            );
            console.debug('Updated subscription last_processed_at in metadata', { 
                subscription_id: subscriptionId, 
                last_processed_at: now 
            });
        } catch (error) {
            console.error('Error updating subscription last_processed_at in metadata', { 
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
            // We're checking if last_processed_at exists in metadata or if it's older than the frequency threshold
            const result = await this.pool.query(
                `SELECT s.id, s.user_id, s.name, s.frequency, s.metadata, 
                        t.id as type_id, t.name as type_name, t.parser_url
                 FROM subscriptions s
                 JOIN subscription_types t ON t.id = s.type_id
                 WHERE s.active = true
                 AND (
                     (s.metadata->>'last_processed_at') IS NULL
                     OR (
                         s.frequency = 'daily' AND 
                         (s.metadata->>'last_processed_at')::timestamptz < NOW() - INTERVAL '1 day'
                     )
                     OR (
                         s.frequency = 'weekly' AND 
                         (s.metadata->>'last_processed_at')::timestamptz < NOW() - INTERVAL '7 days'
                     )
                     OR (
                         s.frequency = 'monthly' AND 
                         (s.metadata->>'last_processed_at')::timestamptz < NOW() - INTERVAL '30 days'
                     )
                 )
                 ORDER BY (s.metadata->>'last_processed_at')::timestamptz ASC NULLS FIRST
                 LIMIT $1`,
                [limit]
            );
            
            // Process results to add last_processed_at field for compatibility
            const subscriptions = result.rows.map(sub => {
                const processedSub = {...sub};
                if (sub.metadata && sub.metadata.last_processed_at) {
                    processedSub.last_processed_at = sub.metadata.last_processed_at;
                } else {
                    processedSub.last_processed_at = null;
                }
                return processedSub;
            });
            
            return subscriptions;
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