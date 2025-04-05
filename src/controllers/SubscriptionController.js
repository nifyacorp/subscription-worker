const { getLogger } = require('../../../config/logger');

class SubscriptionController {
    constructor({ subscriptionService, processTrackingRepository }) {
        if (!subscriptionService || !processTrackingRepository) {
            throw new Error('SubscriptionController requires SubscriptionService and ProcessTrackingRepository');
        }
        this.subscriptionService = subscriptionService;
        this.processTrackingRepository = processTrackingRepository;
        this.logger = getLogger('subscription-controller');

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
        this.logger.info('Received request to process subscription', { subscription_id: id, path: req.path });

        // --- Input Validation (Basic) ---
        if (!id || id === 'undefined' || id === 'null') {
            this.logger.warn('Invalid subscription ID received', { subscription_id: id });
            return res.status(400).json({ status: 'error', error: 'Invalid subscription ID' });
        }

        // --- Prevent Duplicate Processing (Rate Limiting / Locking) ---
        if (this.activeProcessing.has(id)) {
            const processingData = this.activeProcessing.get(id);
            const timeDiff = Date.now() - processingData.startTime;
            
            // Define a reasonable time window (e.g., 10 seconds)
            const DUPLICATE_WINDOW_MS = 10000; 

            if (timeDiff < DUPLICATE_WINDOW_MS) {
                this.logger.warn('Duplicate processing request within window', {
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
            this.logger.warn('Allowing re-processing request after window expired', {
                 subscription_id: id, time_diff_ms: timeDiff
            });
        }

        // --- Mock DB Check (Moved from Router) ---
        if (req.app?.locals?.mockDatabaseMode || this.subscriptionService.isMockMode) { // Check both app state and potentially service state
            this.logger.error('Cannot process subscription in mock database mode', { subscription_id: id });
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
            this.logger.info('Created processing record', { subscription_id: id, processing_id: processingId });

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
                    this.logger.info('Starting async processing', { subscription_id: id, processing_id: processingId });
                    // Delegate the actual processing to the service
                    const result = await this.subscriptionService.processSubscription(id);
                    
                    if (result.status === 'error') {
                        processingStatus = 'error';
                        processingError = result.error;
                        this.logger.warn('Async processing finished with error', {
                            subscription_id: id, processing_id: processingId, error: processingError
                        });
                    } else {
                        this.logger.info('Async processing completed successfully', {
                            subscription_id: id, processing_id: processingId, status: result.status
                        });
                    }
                } catch (asyncError) {
                    processingStatus = 'error';
                    processingError = asyncError.message;
                    this.logger.error('Unhandled error during async processing', {
                        subscription_id: id, processing_id: processingId, error: processingError, stack: asyncError.stack
                    });
                } finally {
                    // 5. Update Processing Record Status
                    try {
                        await this.processTrackingRepository.updateRecordStatus(processingId, processingStatus, { error: processingError });
                        this.logger.info('Updated processing record status', { processing_id: processingId, status: processingStatus });
                    } catch (updateError) {
                         this.logger.error('Failed to update final processing record status', {
                            processing_id: processingId, error: updateError.message
                        });
                    }
                    // 6. Clear Active Processing Lock
                    this.activeProcessing.delete(id);
                    this.logger.debug('Removed processing lock', { subscription_id: id });
                }
            });

        } catch (error) {
            // Handle errors during initial setup (e.g., creating processing record)
            this.logger.error('Error setting up subscription processing', {
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
        this.logger.info('Received request for batch subscription processing');
        try {
            // Delegate to the service layer
            // Note: The service method might need refinement based on actual batch logic
            const result = await this.subscriptionService.processPendingSubscriptions(); 
            
            this.logger.info('Batch processing request completed', { status: result.status, processed: result.processed });
            res.status(200).json(result);
        } catch (error) {
            this.logger.error('Error during batch subscription processing request', {
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
        this.logger.debug('Received request to get pending subscriptions');
        try {
            // Delegate to the process tracking repository
            const pendingRecords = await this.processTrackingRepository.findPendingRecords(); 
            
            res.status(200).json({
                subscriptions: pendingRecords, // Adjust field name if needed
                count: pendingRecords.length
            });
        } catch (error) {
            this.logger.error('Failed to fetch pending subscription records', {
                error: error.message,
                stack: error.stack
            });
            next(error);
        }
    }
}

module.exports = SubscriptionController; 