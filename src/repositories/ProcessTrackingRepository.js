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
     * @param {Object} [initialMetadata={}] - Initial metadata.
     * @returns {Promise<Object>} The created processing record (including its ID).
     */
    async createRecord(subscriptionId, initialStatus = 'pending', initialMetadata = {}) {
        console.debug('Creating processing record', { subscription_id: subscriptionId });
        const metadata = { 
            ...initialMetadata, 
            queued_at: new Date().toISOString() 
        };
        try {
            const result = await this.pool.query(
                `INSERT INTO subscription_processing
                 (subscription_id, status, metadata, next_run_at) -- Assuming next_run_at might be set initially
                 VALUES ($1, $2, $3, NOW()) -- Default next_run_at to NOW() or specific logic
                 RETURNING id, subscription_id, status, created_at`, // Return key fields
                [
                    subscriptionId,
                    initialStatus,
                    JSON.stringify(metadata)
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
     * Updates the status and metadata of an existing processing record.
     * @param {string} processingId - The ID of the processing record.
     * @param {string} status - The new status (e.g., 'processing', 'completed', 'error').
     * @param {Object} [metadataUpdates={}] - Additional metadata to merge.
     * @returns {Promise<Object>} The updated processing record.
     */
    async updateRecordStatus(processingId, status, metadataUpdates = {}) {
        console.debug('Updating processing record status', { processing_id: processingId, status: status });
        const updateTime = new Date().toISOString();
        const metadata = { 
            ...metadataUpdates, 
            [`${status}_at`]: updateTime // Add timestamp for the status change
        };

        // Determine fields to update based on status
        let setClauses = [
            'status = $1',
            'metadata = metadata || $2::jsonb',
            'updated_at = NOW()'
        ];
        let queryParams = [status, JSON.stringify(metadata), processingId];

        if (status === 'completed' || status === 'error') {
            setClauses.push('last_run_at = NOW()'); // Update last_run_at on completion/error
            // Potentially update next_run_at based on frequency if applicable for retries/scheduling
        }
        if (status === 'error' && metadataUpdates.error) {
             setClauses.push('error = $4') // Add error message if present
             queryParams.splice(3, 0, metadataUpdates.error); // Insert error message param
        } else {
             setClauses.push('error = NULL') // Clear error on non-error status
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
                    sp.metadata,
                    sp.error,
                    s.user_id,
                    s.type as subscription_type, -- Renamed from type_id/type_name for clarity
                    -- st.name as type_name, -- Removed join unless type_name is essential here
                    s.active as subscription_active,
                    s.prompts,
                    -- s.frequency, -- Add if needed
                    s.last_processed_at as subscription_last_processed_at, -- Renamed
                    s.created_at as subscription_created_at,
                    s.updated_at as subscription_updated_at
                FROM subscription_processing sp
                JOIN subscriptions s ON s.id = sp.subscription_id
                -- JOIN subscription_types st ON st.id = s.type_id -- Removed join
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

module.exports = ProcessTrackingRepository; 