// Removed: const { getLogger } = require('../config/logger');

class SubscriptionController {
    constructor({ subscriptionService, processTrackingRepository /* Removed: logger */ }) {
        if (!subscriptionService || !processTrackingRepository) {
            throw new Error('SubscriptionController requires SubscriptionService and ProcessTrackingRepository');
        }
        this.subscriptionService = subscriptionService;
        this.processTrackingRepository = processTrackingRepository;
        // Removed: this.logger = logger || getLogger('subscription-controller');
        // Removed: this.logger.info('Subscription controller initialized');
        console.info('Subscription controller initialized'); // Replace logger

        // Bind methods to ensure 'this' context is correct
        this.processSingleSubscription = this.processSingleSubscription.bind(this);
        this.processBatchSubscriptions = this.processBatchSubscriptions.bind(this);
        this.getPendingSubscriptions = this.getPendingSubscriptions.bind(this); 

        // Active processing tracking (moved from router)
        this.activeProcessing = new Map();
    }

    /**
     * Handles POST /api/subscriptions/process/:id
     * Queues a single subscription for processing.
     */
    async processSingleSubscription(req, res, next) {
        const { id } = req.params;
        // Removed: this.logger.info('Received request to process subscription', { ... });
        console.info('Received request to process subscription', { subscription_id: id }); // Replace logger

        // --- Input Validation (Basic) ---
        if (!id || id === 'undefined' || id === 'null') {
            // Removed: this.logger.warn('Invalid subscription ID received', { ... });
            console.warn('Invalid subscription ID received', { subscription_id: id }); // Replace logger
            return res.status(400).json({ status: 'error', error: 'Invalid subscription ID' });
        }

        // --- Prevent Duplicate Processing (Rate Limiting / Locking) ---
        if (this.activeProcessing.has(id)) {
            const processingData = this.activeProcessing.get(id);
            const timeDiff = Date.now() - processingData.startTime;
            
            // Define a reasonable time window (e.g., 10 seconds)
            const DUPLICATE_WINDOW_MS = 10000; 

            if (timeDiff < DUPLICATE_WINDOW_MS) {
                // Removed: this.logger.warn('Duplicate processing request within window', { ... });
                console.warn('Duplicate processing request within window', {
                    subscription_id: id,
                    time_diff_ms: timeDiff,
                    processing_id: processingData.processingId
                });
                return res.status(429).json({ // 429 Too Many Requests is suitable
                    status: 'pending', // Or 'processing'
                    message: `Subscription processing already requested recently (within ${DUPLICATE_WINDOW_MS / 1000}s).`,
                    processing_id: processingData.processingId,
                    subscription_id: id
                });
            }
            // If it's been longer, allow potential re-processing but log it
            // Removed: this.logger.warn('Allowing re-processing request after window expired', { ... });
            console.warn('Allowing re-processing request after window expired', {
                 subscription_id: id, time_diff_ms: timeDiff
            });
        }

        // --- Mock DB Check (Moved from Router) ---
        if (req.app?.locals?.mockDatabaseMode || this.subscriptionService.isMockMode) { // Check both app state and potentially service state
            // Removed: this.logger.error('Cannot process subscription in mock database mode', { ... });
            console.error('Cannot process subscription in mock database mode', { subscription_id: id }); // Replace logger
            return res.status(503).json({
                status: 'error',
                error: 'Database unavailable',
                message: 'Service is operating in mock database mode.',
                subscription_id: id
            });
        }

        try {
            // 1. Create Processing Record (moved to repository)
            const processingRecord = await this.processTrackingRepository.createRecord(id);
            const processingId = processingRecord.id;
            // Removed: this.logger.info('Created processing record', { ... });
            console.info('Created processing record', { processing_id: processingId }); // Replace logger

            // 2. Track Active Processing
            this.activeProcessing.set(id, {
                startTime: Date.now(),
                processingId: processingId
            });

            // 3. Respond 202 Accepted Immediately
            res.status(202).json({
                status: 'queued',
                message: 'Subscription queued for processing',
                processing_id: processingId,
                subscription_id: id
            });

            // 4. Trigger Async Processing (using setImmediate or a proper queue)
            setImmediate(async () => {
                let processingStatus = 'completed';
                let processingError = null;
                try {
                    // Removed: this.logger.info('Starting async processing', { ... });
                    console.info('Starting async processing', { subscription_id: id, processing_id: processingId }); // Replace logger
                    // Delegate the actual processing to the service
                    const result = await this.subscriptionService.processSubscription(id);
                    
                    if (result.status === 'error') {
                        processingStatus = 'error';
                        processingError = result.error;
                        // Removed: this.logger.warn('Async processing finished with error', { ... });
                        console.warn('Async processing finished with error', {
                            subscription_id: id, processing_id: processingId, error: processingError
                        });
                    } else {
                        // Removed: this.logger.info('Async processing completed successfully', { ... });
                        console.info('Async processing completed successfully', {
                            subscription_id: id, processing_id: processingId, status: result.status
                        });
                    }
                } catch (asyncError) {
                    processingStatus = 'error';
                    processingError = asyncError.message;
                    // Removed: this.logger.error('Unhandled error during async processing', { ... });
                    console.error('Unhandled error during async processing', {
                        subscription_id: id, processing_id: processingId, error: processingError, stack: asyncError.stack
                    });
                } finally {
                    // 5. Update Processing Record Status
                    try {
                        await this.processTrackingRepository.updateRecordStatus(processingId, processingStatus, { error: processingError });
                        // Removed: this.logger.info('Updated processing record status', { ... });
                        console.info('Updated processing record status', { processing_id: processingId, status: processingStatus }); // Replace logger
                    } catch (updateError) {
                         // Removed: this.logger.error('Failed to update final processing record status', { ... });
                         console.error('Failed to update final processing record status', {
                            processing_id: processingId, error: updateError.message
                        });
                    }
                    // 6. Clear Active Processing Lock
                    this.activeProcessing.delete(id);
                    // Removed: this.logger.debug('Removed processing lock', { ... });
                    console.debug('Removed processing lock', { subscription_id: id }); // Replace logger
                }
            });

        } catch (error) {
            // Handle errors during initial setup (e.g., creating processing record)
            // Removed: this.logger.error('Error setting up subscription processing', { ... });
            console.error('Error setting up subscription processing', {
                subscription_id: id,
                error: error.message,
                stack: error.stack
            });
            // Ensure lock is cleared if setup fails
            this.activeProcessing.delete(id);
            // Pass error to Express error handler
            next(error); 
        }
    }

    /**
     * Handles POST /api/subscriptions/batch/process
     * Triggers batch processing of pending subscriptions.
     */
    async processBatchSubscriptions(req, res, next) {
        // Removed: this.logger.info('Received request for batch subscription processing');
        console.info('Received request for batch subscription processing'); // Replace logger
        try {
            // Delegate to the service layer
            // Note: The service method might need refinement based on actual batch logic
            const result = await this.subscriptionService.processPendingSubscriptions(); 
            
            // Removed: this.logger.info('Batch processing request completed', { ... });
            console.info('Batch processing request completed', { status: result.status, processed: result.processed }); // Replace logger
            res.status(200).json(result);
        } catch (error) {
            // Removed: this.logger.error('Error during batch subscription processing request', { ... });
            console.error('Error during batch subscription processing request', {
                error: error.message,
                stack: error.stack
            });
            next(error);
        }
    }

    /**
     * Handles GET /api/subscriptions/pending
     * Retrieves pending subscription processing records.
     */
    async getPendingSubscriptions(req, res, next) {
        // Removed: this.logger.debug('Received request to get pending subscriptions');
        console.debug('Received request to get pending subscriptions'); // Replace logger
        try {
            // Delegate to the process tracking repository
            const pendingRecords = await this.processTrackingRepository.findPendingRecords(); 
            
            res.status(200).json({
                subscriptions: pendingRecords, // Adjust field name if needed
                count: pendingRecords.length
            });
        } catch (error) {
            // Removed: this.logger.error('Failed to fetch pending subscription records', { ... });
            console.error('Failed to fetch pending subscription records', {
                error: error.message,
                stack: error.stack
            });
            next(error);
        }
    }
}

module.exports = { SubscriptionController }; // Ensure export matches import in index.js 