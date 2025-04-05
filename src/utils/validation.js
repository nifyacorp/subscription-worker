const { 
  SubscriptionSchema, 
  ProcessorResultSchema, 
  ProcessingRequestSchema,
  PubSubNotificationSchema  
} = require('../types/schemas');

/**
 * Sanitize subscription data
 * @param {Object} subscription - Subscription data to sanitize
 * @returns {Object} Sanitized subscription data
 */
function sanitizeSubscription(subscription) {
  if (!subscription) return null;

  const sanitized = { ...subscription };

  // Handle prompts that might be stored as strings
  if (typeof sanitized.prompts === 'string') {
    try {
      sanitized.prompts = JSON.parse(sanitized.prompts);
    } catch (error) {
      // If not valid JSON, use as a single prompt
      sanitized.prompts = [sanitized.prompts];
    }
  }

  // Ensure prompts is always an array
  if (!Array.isArray(sanitized.prompts)) {
    if (sanitized.prompts) {
      sanitized.prompts = [String(sanitized.prompts)];
    } else if (sanitized.metadata?.prompts) {
      sanitized.prompts = sanitized.metadata.prompts;
    } else if (sanitized.texts && Array.isArray(sanitized.texts)) {
      sanitized.prompts = sanitized.texts;
    } else if (sanitized.metadata?.texts && Array.isArray(sanitized.metadata.texts)) {
      sanitized.prompts = sanitized.metadata.texts;
    } else {
      sanitized.prompts = [];
    }
  }

  // Filter out empty prompts
  if (Array.isArray(sanitized.prompts)) {
    sanitized.prompts = sanitized.prompts
      .filter(prompt => typeof prompt === 'string' && prompt.trim().length > 0)
      .map(prompt => prompt.trim());
  }

  return sanitized;
}

/**
 * Validate subscription data
 * @param {Object} subscription - Subscription to validate
 * @returns {Object} Validated subscription
 */
function validateSubscription(subscription) {
  try {
    const sanitized = sanitizeSubscription(subscription);
    if (!sanitized) {
      throw new Error('Cannot validate null subscription');
    }

    const result = SubscriptionSchema.safeParse(sanitized);
    
    if (!result.success) {
      console.warn('Subscription validation failed', {
        subscription_id: sanitized.subscription_id || sanitized.id,
        errors: result.error.format()
      });
      
      // Return sanitized data even if validation fails
      return {
        data: sanitized,
        valid: false,
        errors: result.error.format()
      };
    }
    
    return {
      data: result.data,
      valid: true,
      errors: null
    };
  } catch (error) {
    console.error('Error in subscription validation', {
      error: error.message,
      stack: error.stack
    });
    
    return {
      data: subscription,
      valid: false,
      errors: { message: error.message }
    };
  }
}

/**
 * Validate processor result
 * @param {Object} result - Processor result to validate
 * @returns {Object} Validated result
 */
function validateProcessorResult(result) {
  try {
    const parsedResult = ProcessorResultSchema.safeParse(result);
    
    if (!parsedResult.success) {
      console.warn('Processor result validation failed', {
        errors: parsedResult.error.format()
      });
      
      return {
        data: result,
        valid: false,
        errors: parsedResult.error.format()
      };
    }
    
    return {
      data: parsedResult.data,
      valid: true,
      errors: null
    };
  } catch (error) {
    console.error('Error in processor result validation', {
      error: error.message,
      stack: error.stack
    });
    
    return {
      data: result,
      valid: false,
      errors: { message: error.message }
    };
  }
}

/**
 * Validate processing request
 * @param {Object} request - Processing request to validate
 * @returns {Object} Validated request
 */
function validateProcessingRequest(request) {
  try {
    const parsedRequest = ProcessingRequestSchema.safeParse(request);
    
    if (!parsedRequest.success) {
      console.warn('Processing request validation failed', {
        errors: parsedRequest.error.format()
      });
      
      return {
        data: request,
        valid: false,
        errors: parsedRequest.error.format()
      };
    }
    
    return {
      data: parsedRequest.data,
      valid: true,
      errors: null
    };
  } catch (error) {
    console.error('Error in processing request validation', {
      error: error.message,
      stack: error.stack
    });
    
    return {
      data: request,
      valid: false,
      errors: { message: error.message }
    };
  }
}

/**
 * Validate PubSub notification message
 * @param {Object} message - The message to validate
 * @returns {Object} Validation result
 */
function validatePubSubNotification(message) {
  try {
    const parsedMessage = PubSubNotificationSchema.safeParse(message);
    
    if (!parsedMessage.success) {
      console.warn('PubSub notification validation failed', {
        processor_type: message?.processor_type,
        trace_id: message?.trace_id,
        errors: parsedMessage.error.format()
      });
      
      return {
        data: message,
        valid: false,
        errors: parsedMessage.error.format()
      };
    }
    
    return {
      data: parsedMessage.data,
      valid: true,
      errors: null
    };
  } catch (error) {
    console.error('Error in PubSub notification validation', {
      error: error.message,
      stack: error.stack,
      processor_type: message?.processor_type
    });
    
    return {
      data: message,
      valid: false,
      errors: { message: error.message }
    };
  }
}

module.exports = {
  validateSubscription,
  validateProcessorResult,
  validateProcessingRequest,
  validatePubSubNotification,
  sanitizeSubscription
};