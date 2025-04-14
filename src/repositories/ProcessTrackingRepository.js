class ProcessTrackingRepository {
    constructor(pool) {
        if (!pool) {
            throw new Error('ProcessTrackingRepository requires a database pool.');
        }
        this.pool = pool;
        this.maxRetries = 3; // Number of retry attempts for database operations
    }

    /**
     * Creates a new processing record for a subscription.
     * @param {string} subscriptionId - The ID of the subscription being processed.
     * @param {string} [initialStatus='pending'] - The initial status.
     * @param {Object} [subscriptionDetails={}] - Additional details about the subscription.
     * @returns {Promise<Object>} The created processing record (including its ID).
     */
    async createRecord(subscriptionId, initialStatus = 'pending', subscriptionDetails = {}) {
        // Enhanced logging with more details
        console.debug('Creating processing record', { 
            subscription_id: subscriptionId,
            status: initialStatus,
            details: subscriptionDetails,
            timestamp: new Date().toISOString()
        });

        let attempt = 0;
        let lastError = null;

        while (attempt < this.maxRetries) {
            try {
                // Exponential backoff delay between attempts (except first attempt)
                if (attempt > 0) {
                    const delay = Math.pow(2, attempt) * 500; // 1s, 2s, 4s
                    console.info(`Retrying database operation (attempt ${attempt + 1}/${this.maxRetries}) after ${delay}ms delay`, {
                        subscription_id: subscriptionId,
                        previous_error: lastError?.message || 'unknown',
                        error_code: lastError?.code || 'unknown'
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                attempt++;

                const result = await this.pool.query(
                    `INSERT INTO subscription_processing
                     (subscription_id, status)
                     VALUES ($1, $2)
                     RETURNING id, subscription_id, status, created_at`,
                    [
                        subscriptionId,
                        initialStatus
                    ]
                );

                if (result.rowCount === 0) {
                    console.error('Failed to insert processing record', { 
                        subscription_id: subscriptionId,
                        attempt: attempt,
                        max_retries: this.maxRetries
                    });
                    throw new Error('Processing record creation failed in DB.');
                }
                
                console.info('Created processing record successfully', { 
                    processing_id: result.rows[0].id,
                    subscription_id: subscriptionId,
                    status: initialStatus,
                    created_at: result.rows[0].created_at,
                    attempts_needed: attempt
                });
                
                return result.rows[0];
            } catch (error) {
                lastError = error;
                
                // Detailed error logging
                console.error('Error creating processing record in database', { 
                    subscription_id: subscriptionId,
                    error: error.message,
                    error_code: error.code || 'unknown',
                    error_detail: error.detail || 'none',
                    attempt: attempt,
                    max_retries: this.maxRetries,
                    will_retry: attempt < this.maxRetries,
                    stack: error.stack
                });
                
                // Check if we should retry based on error type
                const isRetryableError = 
                    error.code === 'ECONNRESET' || 
                    error.code === 'ETIMEDOUT' || 
                    error.message.includes('timeout') ||
                    error.message.includes('connection') ||
                    error.code === '40P01' || // Deadlock
                    error.code === '57014'; // Query timeout
                
                // If it's not a retryable error or we've exhausted retries, throw
                if (!isRetryableError || attempt >= this.maxRetries) {
                    throw error;
                }
                
                // Otherwise continue the loop to retry
            }
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
            // Instead of completed_at field, store completion info in metadata
            setClauses.push(`metadata = jsonb_set(
                COALESCE(metadata, '{}'),
                '{completed_at}',
                to_jsonb($3::text)
            )`);
            queryParams.splice(2, 0, new Date().toISOString());
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
                    sp.metadata,
                    sp.error as error_message,
                    s.user_id,
                    s.type_id as subscription_type_id,
                    t.name as type_name,
                    t.parser_url,
                    s.active as subscription_active,
                    s.prompts,
                    s.frequency,
                    s.metadata as subscription_metadata,
                    s.created_at as subscription_created_at,
                    s.updated_at as subscription_updated_at
                FROM subscription_processing sp
                JOIN subscriptions s ON s.id = sp.subscription_id
                JOIN subscription_types t ON t.id = s.type_id
                WHERE sp.status = 'pending'
                ORDER BY sp.created_at ASC
            `);
            
            // Process results to add virtual fields for compatibility
            const records = result.rows.map(record => {
                // Add last_processed_at from subscription metadata if available
                if (record.subscription_metadata && record.subscription_metadata.last_processed_at) {
                    record.subscription_last_processed_at = record.subscription_metadata.last_processed_at;
                }
                
                // Add completed_at from processing record metadata if available
                if (record.metadata && record.metadata.completed_at) {
                    record.completed_at = record.metadata.completed_at;
                }
                
                return record;
            });
            
            console.info(`Found ${result.rowCount} pending processing records.`);
            return records;
        } catch (error) {
            console.error('Error fetching pending processing records', { error: error.message });
            throw error;
        }
    }

     // Add other methods like findById, deleteRecord etc. if necessary
}

module.exports = { ProcessTrackingRepository }; 