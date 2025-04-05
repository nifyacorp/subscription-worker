const express = require('express');
const expressPino = require('express-pino-logger');
const { promisify } = require('util');
require('dotenv').config();

// Configuration & Core Utilities
const { getLogger } = require('./src/config/logger');
const { initializePool, createMockPool } = require('./src/config/database');
const { initialize: initializeSecrets } = require('./src/config/secrets');
// Removed: const { initializePubSub } = require('./src/config/pubsub'); // Handled by NotificationClient now

// --- New Structure ---
// Repositories
const SubscriptionRepository = require('./src/repositories/SubscriptionRepository');
const NotificationRepository = require('./src/repositories/NotificationRepository');
const ProcessTrackingRepository = require('./src/repositories/ProcessTrackingRepository');

// Clients
const ParserClient = require('./src/clients/ParserClient');
const NotificationClient = require('./src/clients/NotificationClient');

// Services
const SubscriptionService = require('./src/services/SubscriptionService');

// Controllers
const SubscriptionController = require('./src/controllers/SubscriptionController');

// Routers
const createApiRouter = require('./src/routes/api'); // Assuming a top-level API router
const createHealthRouter = require('./src/routes/health'); 
const createDebugRouter = require('./src/routes/debug'); // Keep debug if needed, adjust dependencies

// --- Initialization ---
const logger = getLogger('server');
const expressLogger = expressPino({ logger });

// --- Helper Functions ---

function validateEnvironment() {
  if (!process.env.PROJECT_ID) {
    process.env.PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
  }
  if (!process.env.PROJECT_ID) {
    logger.warn('PROJECT_ID or GOOGLE_CLOUD_PROJECT environment variable not set. Required for some GCP services.');
    // Decide if this should be a fatal error based on requirements
    // throw new Error('Missing required environment variable: PROJECT_ID or GOOGLE_CLOUD_PROJECT');
  }
   logger.info('Environment validation complete.', { project_id: process.env.PROJECT_ID });
}

async function initializeDatabase() {
  logger.info('Initializing database pool...');
  let pool;
  let mockDatabaseMode = false;
  const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

  try {
    pool = await initializePool();
    // Test connection
    const client = await pool.connect();
    client.release();
    logger.info('Successfully connected to database');
  } catch (dbError) {
    logger.warn('Failed to connect to database', {
      code: dbError.code,
      error: dbError.message,
      environment: process.env.NODE_ENV
    });
    if (isDevelopment) {
      mockDatabaseMode = true;
      pool = createMockPool(); // Use the existing mock pool creator
      logger.info('Created mock database pool for development mode');
    } else {
      logger.error('Database connection is required in non-development mode. Exiting.', { error: dbError.message });
      throw dbError; // Re-throw to stop startup
    }
  }
  return { pool, mockDatabaseMode };
}

async function initializeExternalClients(config) {
     logger.info('Initializing external clients (Parser, Notifications)...');
     
     // Parser Client
     const parserClient = new ParserClient({
         // Pass config if needed, e.g., baseURL from env
         // parserBaseUrl: process.env.PARSER_BASE_URL 
     });
     await parserClient.initialize(); // Fetches API key if needed
     logger.info('Parser client initialized.');

     // Notification Client (PubSub)
     const notificationClient = new NotificationClient({
         projectId: config.projectId,
         enabled: config.pubSubEnabled // Control enablement via config
     });
     // No async init needed for current NotificationClient structure
      logger.info('Notification client initialized.', { enabled: notificationClient.isEnabled });

     return { parserClient, notificationClient };
}

function setupExpressApp(config) {
    logger.info('Setting up Express application...');
    const app = express();

    // Store config/state if needed (use sparingly)
    app.locals.mockDatabaseMode = config.mockDatabaseMode;
    app.locals.logger = logger; // Make logger accessible if needed

    // Core Middleware
    app.use(expressLogger);
    app.use(express.json());

    // TODO: Add other essential middleware (CORS, security headers, etc.)

    logger.info('Express application basic setup complete.');
    return app;
}

function registerRoutes(app, dependencies) {
    logger.info('Registering application routes...');
    const { 
        pool, 
        subscriptionController, 
        // Add other controllers/services needed for routes
        // subscriptionService // For debug router if kept
    } = dependencies;

    // Health Check
    app.use(createHealthRouter(pool)); // Health check might still need direct pool access
    logger.debug('Registered health routes.');

    // API Routes (using the new controller)
    // Assumes createApiRouter takes the controller(s)
    app.use('/api', createApiRouter({ subscriptionController })); 
    // Note: The original code mounted subscription routes at root and /subscriptions
    // This needs to be handled within createApiRouter or adjusted based on desired paths.
    // Example: app.use('/subscriptions', createApiRouter({ subscriptionController }));
    logger.debug('Registered API routes under /api.');


    // Debug Routes (Conditional) - Requires updating createDebugRouter dependencies
    // if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_DEBUG_ROUTES === 'true') {
    //   // Update createDebugRouter to accept necessary dependencies (e.g., service, pool)
    //   // app.use('/debug', createDebugRouter(subscriptionService, pool)); 
    //   logger.info('Debug routes registered under /debug.');
    // } else {
    //    logger.info('Debug routes are disabled.');
    // }

    logger.info('Application routes registered.');
}

function registerErrorHandlers(app) {
    logger.info('Registering error handlers...');

    // Not Found Handler (404) - Place before generic error handler
    app.use((req, res, next) => {
        res.status(404).json({
            status: 'error',
            error: 'Not Found',
            message: `The requested path ${req.path} was not found.`
        });
    });

    // Generic Error Handler (500) - Must have 4 arguments
    app.use((err, req, res, next) => {
      // Log the error using pino logger
      logger.error({
        err: {
            name: err.name,
            message: err.message,
            stack: err.stack,
            // Add custom properties if available, e.g., err.statusCode
            statusCode: err.statusCode, 
            code: err.code 
        },
        req: { // Log request details contextually
            id: req.id, // If request ID middleware is used
            method: req.method,
            url: req.originalUrl || req.url,
            headers: req.headers,
            remoteAddress: req.ip || req.connection?.remoteAddress,
            body: req.body // Be cautious logging sensitive body data
        }
      }, 'Unhandled error occurred in request processing');

      // Determine status code: use error's status code or default to 500
      const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;

      // Send JSON response
      res.status(statusCode).json({
        status: 'error',
        error: err.name || 'InternalServerError',
        // Only include message in non-production environments for security
        message: process.env.NODE_ENV !== 'production' ? err.message : 'An unexpected error occurred.',
        // Optionally include stack trace in development
        // stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      });
    });
    logger.info('Global error handlers registered.');
}


function setupGracefulShutdown(server, pool) {
  const signals = ['SIGINT', 'SIGTERM'];
  
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutdown signal received. Closing server gracefully...');
    
    try {
      // 1. Stop accepting new connections
      await promisify(server.close.bind(server))();
      logger.info('HTTP server closed.');
      
      // 2. Close database pool
      if (pool && typeof pool.end === 'function') {
        await pool.end();
        logger.info('Database pool closed.');
      } else {
         logger.warn('Database pool not available or cannot be closed during shutdown.');
      }
      
      // 3. Add cleanup for other resources if needed (e.g., PubSub clients)

      logger.info('Graceful shutdown complete. Exiting process.');
      process.exit(0);
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error during graceful shutdown');
      process.exit(1); // Exit with error code
    }
  };

  signals.forEach(signal => {
      process.removeAllListeners(signal); // Remove existing listeners first
      process.on(signal, () => shutdown(signal));
  });
  logger.info('Graceful shutdown handlers configured.', { signals });
}

async function startServer() {
  let server;
  let pool; // Keep pool reference for shutdown

  try {
    logger.info('--- Starting Subscription Worker ---');
    
    // 1. Validate Environment
    validateEnvironment();
    const projectId = process.env.PROJECT_ID; // Use validated ID

    // 2. Initialize Secrets Management
    await initializeSecrets(); 
    logger.info('Secret Manager initialized.');

    // 3. Initialize Database
    const db = await initializeDatabase();
    pool = db.pool; // Assign to outer scope variable for shutdown
    const mockDatabaseMode = db.mockDatabaseMode;

    // 4. Initialize External Clients (Parser, PubSub)
    const { parserClient, notificationClient } = await initializeExternalClients({ 
        projectId: projectId, 
        pubSubEnabled: process.env.NODE_ENV === 'production' // Example: Enable PubSub only in prod
    });
    
    // --- Dependency Injection Setup ---
    logger.info('Instantiating application components...');
    const dependencies = {
        logger: logger,
        pool: pool,
        parserClient: parserClient,
        notificationClient: notificationClient,
        subscriptionRepository: new SubscriptionRepository(pool),
        notificationRepository: new NotificationRepository(pool),
        processTrackingRepository: new ProcessTrackingRepository(pool),
    };
    // Inject logger into repositories/clients if they don't default
    // dependencies.subscriptionRepository.logger = logger; 
    
    dependencies.subscriptionService = new SubscriptionService(dependencies);
    dependencies.subscriptionController = new SubscriptionController(dependencies);
    logger.info('Application components instantiated.');
    
    // 5. Setup Express App
    const app = setupExpressApp({ mockDatabaseMode });
    
    // 6. Register Routes (injecting dependencies)
    registerRoutes(app, dependencies);
    
    // 7. Register Error Handlers (must be last)
    registerErrorHandlers(app);

    // 8. Start HTTP Server
    const port = process.env.PORT || 8080;
    server = app.listen(port, () => {
      logger.info({ 
        phase: 'server_started',
        port,
        node_env: process.env.NODE_ENV,
        project_id: projectId,
        mock_db_mode: mockDatabaseMode
      }, `Server listening on port ${port}`);
    });
    
    // 9. Setup Graceful Shutdown
    setupGracefulShutdown(server, pool);
    
    logger.info('--- Subscription Worker Started Successfully ---');
    // Optional: return server and pool if needed by calling code (e.g., for tests)
    // return { server, pool }; 

  } catch (error) {
    logger.fatal({
      phase: 'server_startup_failed',
      error: error.message,
      stack: error.stack,
      code: error.code
    }, 'Fatal error during server startup. Exiting.');
    
    // Attempt graceful shutdown of pool if it exists
    if (pool && typeof pool.end === 'function') {
        try { await pool.end(); } catch (e) { logger.error('Error closing pool during failed startup', e); }
    }
    process.exit(1);
  }
}

// --- Global Unhandled Error Catching ---
const handleFatalError = (error, type) => {
  logger.fatal({
    phase: 'fatal_error',
    error_type: type,
    error_name: error.name,
    error_message: error.message,
    error_stack: error.stack,
    error_code: error.code,
  }, `Fatal unhandled error detected: ${type}. Process will exit.`);
  
  // Attempt to close pool before forced exit
  // This might not always work depending on the state
//   if (globalPoolReference && typeof globalPoolReference.end === 'function') { 
//      try { await globalPoolReference.end(); } catch (e) { console.error('Failed to close pool on fatal error:', e); }
//   }
  
  // Give logger a moment to flush before exiting
  setTimeout(() => process.exit(1), 500); 
};

process.on('uncaughtException', (error) => handleFatalError(error, 'uncaughtException'));
process.on('unhandledRejection', (reason, promise) => {
    // Ensure reason is treated as an error object
    const error = (reason instanceof Error) ? reason : new Error(`Unhandled Rejection: ${reason}`);
    logger.warn({ promise }, 'Unhandled promise rejection detected.'); // Log the promise if helpful
    handleFatalError(error, 'unhandledRejection');
});

// --- Start the Application ---
startServer();

// Removed old mock pool function definition - now imported from database.js
// Removed old SubscriptionProcessor import - now using SubscriptionService
// Removed direct route imports (boe, subscriptions) - handled by api router