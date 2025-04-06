/**
 * Request Validation Middleware
 * 
 * Provides validation for API requests with helpful error messages.
 */

const { 
  SubscriptionSchema, 
  ProcessorResultSchema, 
  ProcessingRequestSchema,
  PubSubNotificationSchema  
} = require('../types/schemas');

/**
 * Validate UUID format
 * @param {string} id - UUID to validate
 * @returns {boolean} Whether the UUID is valid
 */
function isValidUUID(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validate ISO date format
 * @param {string} date - Date to validate
 * @returns {boolean} Whether the date is valid
 */
function isValidDate(date) {
  if (!date) return false;
  
  // Check if in ISO format (YYYY-MM-DD)
  const isoRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoRegex.test(date)) return false;
  
  // Check if date is valid
  const parsedDate = new Date(date);
  return parsedDate instanceof Date && !isNaN(parsedDate);
}

/**
 * Validate subscription ID parameter
 */
function validateSubscriptionId(req, res, next) {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({
      status: 'error',
      error: 'Missing subscription ID',
      message: 'A subscription ID is required',
      usage: {
        example: '/api/subscriptions/process/123e4567-e89b-12d3-a456-426614174000'
      }
    });
  }
  
  if (!isValidUUID(id)) {
    return res.status(400).json({
      status: 'error',
      error: 'Invalid subscription ID format',
      message: 'Subscription ID must be a valid UUID',
      provided: id,
      usage: {
        example: '/api/subscriptions/process/123e4567-e89b-12d3-a456-426614174000'
      }
    });
  }
  
  next();
}

/**
 * Validate BOE process request
 */
function validateBOERequest(req, res, next) {
  const errors = [];
  
  // Validate prompts
  if (!req.body.prompts) {
    errors.push('Missing required field: prompts');
  } else if (!Array.isArray(req.body.prompts)) {
    errors.push('prompts must be an array of strings');
  } else if (req.body.prompts.length === 0) {
    errors.push('prompts array cannot be empty');
  } else {
    for (const prompt of req.body.prompts) {
      if (typeof prompt !== 'string') {
        errors.push('All prompts must be strings');
        break;
      }
    }
  }
  
  // Validate user_id if provided
  if (req.body.user_id && !isValidUUID(req.body.user_id)) {
    errors.push('user_id must be a valid UUID');
  }
  
  // Validate subscription_id if provided
  if (req.body.subscription_id && !isValidUUID(req.body.subscription_id)) {
    errors.push('subscription_id must be a valid UUID');
  }
  
  // Validate options if provided
  if (req.body.options) {
    if (typeof req.body.options !== 'object') {
      errors.push('options must be an object');
    } else {
      // Validate limit if provided
      if (req.body.options.limit !== undefined) {
        const limit = parseInt(req.body.options.limit);
        if (isNaN(limit) || limit <= 0) {
          errors.push('options.limit must be a positive number');
        }
      }
      
      // Validate date if provided
      if (req.body.options.date && !isValidDate(req.body.options.date)) {
        errors.push('options.date must be a valid date in ISO format (YYYY-MM-DD)');
      }
    }
  }
  
  // If there are validation errors, return them
  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      error: 'Validation failed',
      message: 'The request contains validation errors',
      validation_errors: errors,
      usage: {
        description: 'Process a BOE subscription with specific parameters',
        example_body: {
          prompts: ['Example search term', 'Another search term'],
          user_id: '123e4567-e89b-12d3-a456-426614174000', // optional
          subscription_id: '123e4567-e89b-12d3-a456-426614174000', // optional
          options: {
            limit: 10, // optional
            date: '2023-01-01' // optional
          }
        }
      }
    });
  }
  
  next();
}

/**
 * Validate batch process request
 */
function validateBatchRequest(req, res, next) {
  // For batch processing, we don't require any specific parameters
  // but we can validate request.body format if provided

  if (req.body && Object.keys(req.body).length > 0) {
    const errors = [];
    
    // Validate subscriptions if provided
    if (req.body.subscriptions !== undefined) {
      if (!Array.isArray(req.body.subscriptions)) {
        errors.push('subscriptions must be an array');
      } else {
        for (let i = 0; i < req.body.subscriptions.length; i++) {
          const sub = req.body.subscriptions[i];
          if (!sub.subscription_id) {
            errors.push(`subscriptions[${i}] is missing subscription_id`);
          } else if (!isValidUUID(sub.subscription_id)) {
            errors.push(`subscriptions[${i}].subscription_id must be a valid UUID`);
          }
        }
      }
    }
    
    // Validate limit if provided
    if (req.body.limit !== undefined) {
      const limit = parseInt(req.body.limit);
      if (isNaN(limit) || limit <= 0) {
        errors.push('limit must be a positive number');
      }
    }
    
    // If there are validation errors, return them
    if (errors.length > 0) {
      return res.status(400).json({
        status: 'error',
        error: 'Validation failed',
        message: 'The request contains validation errors',
        validation_errors: errors,
        usage: {
          description: 'Process subscriptions in batch',
          example_body: {
            subscriptions: [
              { subscription_id: '123e4567-e89b-12d3-a456-426614174000' },
              { subscription_id: '123e4567-e89b-12d3-a456-426614174001' }
            ],
            limit: 10 // optional
          }
        }
      });
    }
  }
  
  next();
}

module.exports = {
  validateSubscriptionId,
  validateBOERequest,
  validateBatchRequest
};