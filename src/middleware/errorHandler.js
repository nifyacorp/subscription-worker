/**
 * Error Handler Middleware
 * 
 * Provides standardized error handling with helpful responses for API consumers.
 * When an error occurs, it returns a well-structured response with guidance
 * on how to properly use the endpoint.
 */

const ZodError = require('zod').ZodError;

/**
 * Route documentation map containing usage information for endpoints
 * Used to provide helpful guidance when errors occur
 */
const routeDocumentation = {
  // Health route
  '/health': {
    GET: {
      description: 'Check service health',
      response_format: { status: 'healthy|unhealthy', database: 'connection status' }
    }
  },
  
  // Subscription routes
  '/api/subscriptions/process/:id': {
    POST: {
      description: 'Process a specific subscription',
      path_params: [
        { name: 'id', description: 'Subscription ID (UUID)' }
      ],
      response_format: { 
        status: 'success|error', 
        message: 'Processing status message',
        processing_id: 'UUID of the processing record',
        subscription_id: 'UUID of the subscription' 
      }
    }
  },
  
  '/api/subscriptions/pending': {
    GET: {
      description: 'List pending subscriptions',
      query_params: [
        { name: 'limit', description: 'Maximum number of subscriptions to return (optional)' },
        { name: 'type', description: 'Filter by subscription type (optional)' }
      ],
      response_format: { 
        subscriptions: 'Array of subscription objects',
        count: 'Total count of returned subscriptions'
      }
    }
  },
  
  '/api/subscriptions/batch/process': {
    POST: {
      description: 'Process multiple pending subscriptions in batch',
      response_format: { 
        status: 'success|error',
        processed: 'Number of subscriptions processed',
        success_count: 'Number of successfully processed subscriptions',
        error_count: 'Number of failed subscriptions'
      }
    }
  },
  
  // BOE specific routes
  '/api/boe/process': {
    POST: {
      description: 'Process a BOE subscription with specific parameters',
      body: {
        prompts: ['Array of search terms'],
        user_id: 'User ID (UUID)',
        subscription_id: 'Subscription ID (UUID)',
        options: {
          limit: 'Maximum number of results (optional)',
          date: 'Date to search for (YYYY-MM-DD, optional)'
        }
      },
      response_format: { 
        status: 'success|error',
        entries: 'Array of matching entries'
      }
    }
  }
};

/**
 * Find the closest matching route documentation for the current request
 * @param {string} path - Request path
 * @param {string} method - HTTP method
 * @returns {Object|null} Route documentation if found
 */
function findRouteDocumentation(path, method) {
  // First try exact match
  if (routeDocumentation[path] && routeDocumentation[path][method]) {
    return routeDocumentation[path][method];
  }
  
  // Try to match routes with path parameters
  for (const [route, methods] of Object.entries(routeDocumentation)) {
    if (methods[method]) {
      // Convert route template to regex pattern
      // e.g., '/api/subscriptions/process/:id' -> '^\/api\/subscriptions\/process\/[^\/]+$'
      const pattern = route
        .replace(/:[^\/]+/g, '[^\/]+') // Replace :param with regex for any non-slash characters
        .replace(/\//g, '\\/') // Escape slashes
        .replace(/\./g, '\\.'); // Escape dots
      
      const regex = new RegExp(`^${pattern}$`);
      
      if (regex.test(path)) {
        return methods[method];
      }
    }
  }
  
  return null;
}

/**
 * Main error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  // Set default status code if not set
  const statusCode = err.statusCode || 500;
  
  // Log the error
  console.error({
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
    status_code: statusCode,
    request_id: req.headers['x-request-id'] || 'unknown'
  }, 'Global error handler caught an error');
  
  // Find documentation for this route
  const routeDoc = findRouteDocumentation(req.path, req.method);
  
  // Prepare the error response
  const errorResponse = {
    status: 'error',
    error: err.name || 'Error',
    message: err.message || 'An unexpected error occurred'
  };
  
  // Add validation errors if available
  if (err.validationErrors) {
    errorResponse.validation_errors = err.validationErrors;
  }
  
  // Add request ID if available
  if (req.headers['x-request-id']) {
    errorResponse.request_id = req.headers['x-request-id'];
  }
  
  // Add helpful usage information if available
  if (routeDoc) {
    errorResponse.usage = {
      description: routeDoc.description,
      method: req.method,
      path: req.path
    };
    
    // Add path parameters if defined
    if (routeDoc.path_params) {
      errorResponse.usage.path_params = routeDoc.path_params;
    }
    
    // Add query parameters if defined
    if (routeDoc.query_params) {
      errorResponse.usage.query_params = routeDoc.query_params;
    }
    
    // Add body schema if defined
    if (routeDoc.body) {
      errorResponse.usage.body = routeDoc.body;
    }
    
    // Add response format if defined
    if (routeDoc.response_format) {
      errorResponse.usage.response_format = routeDoc.response_format;
    }
  } else {
    // If no specific documentation, add general API help link
    errorResponse.help = 'For API documentation, see /api or refer to the README.md file';
  }
  
  // Add stack trace in development mode
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }
  
  // Send the response
  res.status(statusCode).json(errorResponse);
};

/**
 * Handle 404 Not Found errors
 */
const notFoundHandler = (req, res, next) => {
  console.warn({
    path: req.path,
    method: req.method,
    headers: req.headers,
    query: req.query
  }, 'Route not found');
  
  res.status(404).json({
    status: 'error',
    error: 'Not Found',
    message: `The requested endpoint ${req.method} ${req.path} does not exist`,
    available_endpoints: {
      '/api': 'API documentation',
      '/health': 'Health check endpoint',
      '/api/subscriptions/process/:id': 'Process a subscription',
      '/api/subscriptions/pending': 'List pending subscriptions',
      '/api/subscriptions/batch/process': 'Process subscriptions in batch',
      '/api/boe/process': 'Process BOE-specific subscription'
    }
  });
};

module.exports = { errorHandler, notFoundHandler };