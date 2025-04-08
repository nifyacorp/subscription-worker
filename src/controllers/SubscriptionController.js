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
        
        // --- Check for duplicate processing ---
        if (this.activeProcessing.has(id)) {
            const { processingId, startTime } = this.activeProcessing.get(id);
            console.info('Subscription is already being processed', { 
                subscription_id: id, 
                processing_id: processingId,
                started_at: new Date(startTime).toISOString()
            });
            
            return res.status(202).json({
                status: 'processing',
                message: 'Subscription is already being processed',
                processing_id: processingId,
                subscription_id: id
            });
        }
        
        try {
            // --- Step 1: Create processing record ---
            console.debug('Creating processing record for subscription', { subscription_id: id });
            const processingRecord = await this.processTrackingRepository.createRecord(id);
            const processingId = processingRecord.id;
            
            // --- Step 2: Register in active processing map ---
            this.activeProcessing.set(id, {
                processingId,
                startTime: Date.now()
            });
            
            // --- Step 3: Send initial response ---
            console.info('Subscription queued for processing', { subscription_id: id, processing_id: processingId });
            res.status(202).json({
                status: 'success',
                message: 'Subscription queued for processing',
                processing_id: processingId,
                subscription_id: id
            });
            
            // --- Step 4: Process subscription asynchronously ---
            setImmediate(async () => {
                try {
                    // This will handle subscription retrieval, parser selection, and processing
                    const result = await this.subscriptionService.processSubscription(id);
                    
                    console.info('Subscription processed successfully', {
                        subscription_id: id,
                        processing_id: processingId,
                        status: result.status,
                        matches: result.matches_count,
                        notifications: result.notifications_created
                    });
                } catch (processingError) {
                    console.error('Error processing subscription', {
                        subscription_id: id,
                        processing_id: processingId,
                        error: processingError.message,
                        stack: processingError.stack
                    });
                    
                    try {
                        // Update processing record with error status
                        await this.processTrackingRepository.updateStatus(
                            processingId, 
                            'error'
                        );
                    } catch (updateError) {
                        console.error('Failed to update processing status after error', {
                            processing_id: processingId,
                            error: updateError.message
                        });
                    }
                } finally {
                    // Clear from active processing map
                    this.activeProcessing.delete(id);
                }
            });
            
            // Note: Response already sent, async processing continues
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
     * Handles GET /api/subscriptions/pending
     * Retrieves information about pending subscriptions.
     */
    async getPendingSubscriptions(req, res, next) {
        try {
            // Removed: this.logger.info('Fetching pending subscriptions');
            console.info('Fetching pending subscriptions'); // Replace logger
            
            // Use the service to get pending subscriptions
            const pendingSubscriptions = await this.subscriptionService.getPendingSubscriptions();
            
            // Format response
            const response = {
                status: 'success',
                count: pendingSubscriptions.length,
                data: pendingSubscriptions
            };
            
            res.status(200).json(response);
        } catch (error) {
            // Removed: this.logger.error('Error fetching pending subscriptions', { ... });
            console.error('Error fetching pending subscriptions', {
                error: error.message,
                stack: error.stack
            });
            
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
}

module.exports = { SubscriptionController }; 