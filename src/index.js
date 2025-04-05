/**
 * Subscription Worker
 * Main application entry point
 */
const express = require('express');
const expressPino = require('express-pino-logger');
const { promisify } = require('util');
require('dotenv').config();

const { initializePool } = require('./config/database');
const { getSecret, initialize: initializeSecrets } = require('./config/secrets');
const { initializePubSub } = require('./config/pubsub');
const createApiRouter = require('./routes/api');
const createLegacyRouter = require('./routes/legacy');
const createHealthRouter = require('./routes/health');

// Repositories
const { SubscriptionRepository, NotificationRepository, ProcessTrackingRepository } = require('./repositories');

// Clients
const ParserClient = require('./clients/ParserClient');
const NotificationClient = require('./clients/NotificationClient');

// Service
const SubscriptionService = require('./services/SubscriptionService');
const { SubscriptionController } = require('./controllers/SubscriptionController');

// Global variables and configuration
let pool;
let mockDatabaseMode = false;

/**
 * Validate required environment variables
 */
function validateEnvironment() {
  // Set PROJECT_ID from GOOGLE_CLOUD_PROJECT if not already set
  if (!process.env.PROJECT_ID) {
    process.env.PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
  }

  if (!process.env.PROJECT_ID) {
    throw new Error('Missing required environment variable: PROJECT_ID or GOOGLE_CLOUD_PROJECT');
  }
}

/**
 * Set up graceful shutdown handlers
 * @param {Object} server - HTTP server instance
 * @param {Object} pool - Database pool
 */
function setupGracefulShutdown(server, pool) {
  // Remove existing listeners
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');

  const shutdown = async (signal) => {
    console.info('Shutdown signal received...');
    
    try {
      await promisify(server.close.bind(server))();
      console.info('Server closed');
      
      if (pool) {
        await pool.end();
        console.info('Database pool closed');
      }
      
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Create a mock database pool for development
 * @returns {Object} Mock database pool
 */
function createMockPool() {
  console.debug('Creating mock database pool');
  
  // Create a mock client that throws clear errors
  const createMockClient = () => {
    return {
      query: () => {
        throw new Error('Mock database client cannot execute queries. Please ensure PostgreSQL is running.');
      },
      release: () => {
        console.debug('Mock client released');
      }
    };
  };
  
  // Return a mock pool with implementations that will fail gracefully with informative errors
  return {
    totalCount: 5,
    idleCount: 5, 
    waitingCount: 0,
    
    connect: async () => {
      console.debug('Mock database connect called');
      if (Math.random() < 0.3) {
        // Sometimes throw to simulate transient errors
        throw new Error('Mock database connection temporarily unavailable (simulated error)');
      }
      return createMockClient();
    },
    
    query: async () => {
      console.debug('Mock database query called');
      throw new Error('Mock database pool cannot execute queries. Please ensure PostgreSQL is running.');
    },
    
    on: (event, callback) => {
      console.debug(`Mock pool registered event listener for: ${event}`);
      return this;
    },
    
    end: async () => {
      console.debug('Mock pool end called');
      return Promise.resolve();
    },
    
    // Flag to identify this as a mock pool
    _mockPool: true
  };
}

/**
 * Registers application routes.
 */
function registerRoutes(app, dependencies) {
    console.info('Registering application routes...');
    const { 
        pool, 
        subscriptionController, 
        parserApiKey 
    } = dependencies;

    // Health Check
    app.use(createHealthRouter(pool));
    console.debug('Registered health routes.');

    // API Routes
    app.use('/api', createApiRouter({ subscriptionController, parserApiKey, pool })); 
    console.debug('Registered API routes under /api.');

    // Legacy Routes (Commented out)
    // app.use(createLegacyRouter({ parserApiKey })); 
    // console.debug('Legacy routes registration skipped.');

    // Forward root level requests (Adjust if needed)
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/') || req.path === '/' || req.path === '/health' || req.path === '/_health') {
        return next();
      }
      console.debug(`Redirecting non-API request: ${req.path} -> /api${req.path}`);
      req.url = `/api${req.path}`;
      next('route');
    });

    console.info('Application routes registered.');
}

/**
 * Registers global error handlers.
 */
function registerErrorHandlers(app) {
    console.info('Registering error handlers...');
    // 404 Handler
    app.use(notFoundHandler);
    // Generic Error Handler
    app.use(errorHandler);
    console.info('Global error handlers registered.');
}

/**
 * Start the server
 */
async function startServer() {
  let pool;
  let server;
  let mockDatabaseMode = false;

  try {
    console.info('--- Starting Subscription Worker ---');
    validateEnvironment();
    const projectId = process.env.PROJECT_ID;

    // Init Secrets
    console.debug('Initializing Secret Manager');
    await initializeSecrets();
    console.debug('Secret Manager initialized');

    // Init PubSub (for NotificationClient)
    console.debug('Initializing PubSub infrastructure');
    const pubsubConfig = await initializePubSub(); // Assume this returns necessary config or client instance
    console.debug('PubSub infrastructure initialized');

    // Init DB
    console.debug('Initializing database pool');
    try {
      pool = await initializePool();
      const client = await pool.connect(); client.release();
      console.info('Successfully connected to database');
    } catch (dbError) {
      console.warn('Failed to connect to database', { error: dbError.message, code: dbError.code });
      if (process.env.NODE_ENV === 'development') {
        mockDatabaseMode = true;
        pool = createMockPool();
        console.info('Created mock database pool for development');
      } else {
        console.error('Database connection required in production mode', { error: dbError.message });
        throw dbError;
      }
    }

    // --- Dependency Injection Setup ---
    console.info('Instantiating application components...');
    
    // Clients
    const parserClient = new ParserClient({}); // Add config if needed
    // NotificationClient might need pubsubConfig or projectId
    const notificationClient = new NotificationClient({ projectId, pubsubClient: pubsubConfig?.pubSubClient /* adjust based on initializePubSub */ }); 

    // Repositories
    const subscriptionRepository = new SubscriptionRepository(pool);
    const notificationRepository = new NotificationRepository(pool);
    const processTrackingRepository = new ProcessTrackingRepository(pool);

    // Service
    const subscriptionService = new SubscriptionService({
        subscriptionRepository,
        notificationRepository,
        parserClient, // Inject the client instance
        notificationClient,
    });

    // Controller
    const subscriptionController = new SubscriptionController({
        subscriptionService,
        processTrackingRepository
    });

    // Collect dependencies needed for routing
    const routeDependencies = {
        pool,
        subscriptionController,
        // Add parserApiKey if createApiRouter or others need it directly
        // parserApiKey: await getSecret('PARSER_API_KEY').catch(() => null) 
    };
    console.info('Application components instantiated.');

    // --- Setup Express App ---
    const app = express();
    app.locals.mockDatabaseMode = mockDatabaseMode;
    app.use(express.json());
    
    // Middleware to check mock DB status (keep if needed)
    app.use((req, res, next) => {
      if (mockDatabaseMode && (req.path.includes('/process') || req.path.includes('/batch'))) {
        console.warn('Attempt to use DB-dependent endpoint in mock mode', { path: req.path });
        return res.status(503).json({ status: 'error', error: 'Database unavailable in mock mode' });
      }
      next();
    });

    // Register Routes
    registerRoutes(app, routeDependencies);
    
    // Register Error Handlers (must be last)
    registerErrorHandlers(app);

    // --- Start Server ---
    const port = process.env.PORT || 8080;
    server = app.listen(port, () => {
      console.info({ port, node_env: process.env.NODE_ENV }, `Server listening on port ${port}`);
    });
    
    setupGracefulShutdown(server, pool);
    console.info('--- Subscription Worker Started Successfully ---');

  } catch (error) {
    console.error({ phase: 'server_startup_failed', error: error.message, stack: error.stack }, 'Fatal error during server startup.');
    if (pool && typeof pool.end === 'function') { try { await pool.end(); } catch (e) { console.error('Error closing pool during failed startup', e); } }
    process.exit(1);
  }
}

// Global error handlers
const handleFatalError = (error, type) => {
  console.error({
    phase: 'fatal_error',
    error,
    errorName: error.name,
    errorCode: error.code,
    errorStack: error.stack,
    errorMessage: error.message,
    type
  }, `Fatal error detected: ${type}`);
  process.exit(1);
};

process.on('uncaughtException', (error) => handleFatalError(error, 'uncaughtException'));
process.on('unhandledRejection', (error) => handleFatalError(error, 'unhandledRejection'));

// Start the application
startServer();