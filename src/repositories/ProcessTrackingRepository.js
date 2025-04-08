class ProcessTrackingRepository {
    constructor(pool) {
        if (!pool) {
            throw new Error('ProcessTrackingRepository requires a database pool.');
        }
        this.pool = pool;
    }

    /**
     * Creates a new processing record for a subscription.
     * @param {string} subscriptionId - The ID of the subscription being processed.
     * @param {string} [initialStatus='pending'] - The initial status.
     * @returns {Promise<Object>} The created processing record (including its ID).
     */
    async createRecord(subscriptionId, initialStatus = 'pending') {
        console.debug('Creating processing record', { subscription_id: subscriptionId });
        try {
            const result = await this.pool.query(
                `INSERT INTO subscription_processing
                 (subscription_id, status, next_run_at) -- Removed metadata column
                 VALUES ($1, $2, NOW()) -- Default next_run_at to NOW() or specific logic
                 RETURNING id, subscription_id, status, created_at`, // Return key fields
                [
                    subscriptionId,
                    initialStatus
                ]
            );

            if (result.rowCount === 0) {
                console.error('Failed to insert processing record', { subscription_id: subscriptionId });
                throw new Error('Processing record creation failed in DB.');
            }
            console.info('Created processing record successfully', { processing_id: result.rows[0].id });
            return result.rows[0];
        } catch (error) {
            console.error('Error creating processing record in database', { error: error.message });
            throw error;
        }
    }

    /**
     * Updates the status of an existing processing record.
     * @param {string} processingId - The ID of the processing record.
     * @param {string} status - The new status (e.g., 'processing', 'completed', 'error').
     * @returns {Promise<Object>} The updated processing record.
     */
    async updateRecordStatus(processingId, status) {
        console.debug('Updating processing record status', { processing_id: processingId, status: status });
        
        // Determine fields to update based on status
        let setClauses = [
            'status = $1',
            'updated_at = NOW()'
        ];
        let queryParams = [status, processingId];

        if (status === 'completed' || status === 'error') {
            setClauses.push('last_run_at = NOW()'); // Update last_run_at on completion/error
            // Potentially update next_run_at based on frequency if applicable for retries/scheduling
        }

        const query = `UPDATE subscription_processing
                       SET ${setClauses.join(', ')}
                       WHERE id = $${queryParams.length} -- ID is always the last param
                       RETURNING *`; // Return the full updated record

        try {
            const result = await this.pool.query(query, queryParams);

            if (result.rowCount === 0) {
                console.warn('Processing record not found for status update', { processing_id: processingId });
                // Decide if this should throw an error or return null
                throw new Error(`Processing record not found: ${processingId}`);
            }
            console.info('Updated processing record status successfully', { processing_id: processingId, status: status });
            return result.rows[0];
        } catch (error) {
            console.error('Error updating processing record status in database', { error: error.message });
            throw error;
        }
    }

    /**
     * Updates the status of a processing record.
     * This is an alias for updateRecordStatus to maintain compatibility with the controller.
     * 
     * @param {string} processingId - The ID of the processing record
     * @param {string} status - The new status
     * @returns {Promise<Object>} The updated processing record
     */
    async updateStatus(processingId, status) {
        return this.updateRecordStatus(processingId, status);
    }

    /**
     * Finds pending processing records, potentially joining with subscription details.
     * @returns {Promise<Array<Object>>} A list of pending processing records.
     */
    async findPendingRecords() {
        console.debug('Finding pending subscription processing records');
        try {
            // Query based on the one from the original route, adjust as needed
             const result = await this.pool.query(`
                SELECT 
                    sp.id as processing_id,
                    sp.subscription_id,
                    sp.status,
                    sp.next_run_at,
                    sp.last_run_at,
                    sp.error,
                    s.user_id,
                    s.type_id as subscription_type_id, -- Updated from type for clarity
                    t.name as type_name, -- Added type name from subscription_types
                    t.parser_url, -- Added parser URL for type info
                    s.active as subscription_active,
                    s.prompts,
                    s.frequency, -- Added as it might be useful for scheduling
                    s.last_processed_at as subscription_last_processed_at,
                    s.created_at as subscription_created_at,
                    s.updated_at as subscription_updated_at
                FROM subscription_processing sp
                JOIN subscriptions s ON s.id = sp.subscription_id
                JOIN subscription_types t ON t.id = s.type_id -- Added join for subscription type details
                WHERE sp.status = 'pending' -- Or other relevant statuses like 'queued', 'retry'
                ORDER BY sp.next_run_at ASC
            `);
            
            console.info(`Found ${result.rowCount} pending processing records.`);
            return result.rows;
        } catch (error) {
            console.error('Error fetching pending processing records', { error: error.message });
            throw error;
        }
    }

     // Add other methods like findById, deleteRecord etc. if necessary
}

module.exports = { ProcessTrackingRepository }; 