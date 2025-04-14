const { 
  ProcessorResultSchema, 
  ProcessingRequestSchema
} = require('../../types/schemas');

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

module.exports = {
  validateProcessorResult,
  validateProcessingRequest
}; 