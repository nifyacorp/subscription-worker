class ProcessingService {
  async processSubscription(subscription, processor, logger) {
    if (!processor) {
      throw new Error(`No processor available for type: ${subscription.type_name}`);
    }

    const startTime = Date.now();
    
    logger.debug({
      subscription_id: subscription.subscription_id,
      prompts: subscription.prompts,
      processor_type: subscription.type_name
    }, 'Starting content analysis');

    const processingResult = await processor.analyzeContent({
      prompts: subscription.prompts,
      user_id: subscription.user_id,
      subscription_id: subscription.subscription_id
    });

    return {
      matches: processingResult?.results || [],
      processing_time_ms: Date.now() - startTime
    };
  }
}

module.exports = ProcessingService;