const { SubscriptionSchema } = require('../../types/schemas');

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

module.exports = {
  validateSubscription,
  sanitizeSubscription
}; 