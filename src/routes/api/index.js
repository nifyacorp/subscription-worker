/**
 * API Routes index
 * This file serves as the main entry point for all API routes.
 */
const express = require('express');

function createApiRouter(options) {
  const { 
    pool,
    parserApiKey,
    subscriptionController
  } = options;
  
  if (!subscriptionController) {
    throw new Error('createApiRouter requires a subscriptionController in options');
  }

  const router = express.Router();
  
  // Import route handlers
  const { createHealthRouter } = require('../health');
  const createSubscriptionsRouter = require('./subscriptions');
  const createBOERouter = require('./boe'); // Use the BOE router from the API folder
  
  // Mount health check route - accessible at /api/health and /api/_health
  router.use(createHealthRouter(pool));
  
  // Mount subscriptions router with proper prefix - this is the primary API path
  const subscriptionsRouter = createSubscriptionsRouter(subscriptionController);
  router.use('/subscriptions', subscriptionsRouter);
  
  // Mount BOE router - specific to BOE subscription type
  router.use('/boe', createBOERouter(parserApiKey));
  
  // Add root level health check routes
  const healthRouter = createHealthRouter(pool);
  router.use(healthRouter);
  
  // API documentation endpoint
  router.get('/', (req, res) => {
    res.status(200).json({
      service: 'Subscription Worker API',
      version: process.env.npm_package_version || '1.0.0',
      description: 'API for processing subscriptions and generating notifications',
      endpoints: {
        '/api/health': 'Health check endpoint',
        '/api/subscriptions/process/:id': 'Process a subscription',
        '/api/subscriptions/pending': 'List pending subscriptions',
        '/api/subscriptions/batch/process': 'Process subscriptions in batch',
        '/api/subscriptions/process-all': 'Process all pending subscriptions (for scheduled jobs)',
        '/api/boe/process': 'Process BOE-specific subscription'
      },
      debug_endpoints: process.env.NODE_ENV !== 'production' || process.env.ENABLE_DEBUG_ROUTES === 'true' 
        ? {
            '/debug/status': 'Check service status',
            '/debug/test-processor/:type': 'Test a specific processor',
            '/debug/test-db': 'Test database connection'
          }
        : 'Debug endpoints are disabled in production mode',
      documentation: 'For detailed API documentation, see the ENDPOINTS.md file or README.md',
      timestamp: new Date().toISOString()
    });
  });
  
  console.info('Main API router created successfully');
  return router;
}

module.exports = createApiRouter;