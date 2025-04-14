const { PubSubNotificationSchema } = require('../../types/schemas');

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
  validatePubSubNotification
}; 