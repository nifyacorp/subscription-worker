const express = require('express');
const expressPino = require('express-pino-logger');
const { promisify } = require('util');
require('dotenv').config();

const { getLogger } = require('./config/logger');
const { initializePool } = require('./config/database');
const { getSecret, initialize: initializeSecrets } = require('./config/secrets');
const { initializePubSub } = require('./config/pubsub');
const SubscriptionProcessor = require('./services/subscription');
const createBOERouter = require('./routes/boe');
const createHealthRouter = require('./routes/health'); 
const createSubscriptionRouter = require('./routes/subscriptions/index');

const logger = getLogger('server');
const expressLogger = expressPino({ logger });

// Global variables and configuration
let pool;
let mockDatabaseMode = false;

function validateEnvironment() {
  // Set PROJECT_ID from GOOGLE_CLOUD_PROJECT if not already set
  if (!process.env.PROJECT_ID) {
    process.env.PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
  }

  if (!process.env.PROJECT_ID) {
    throw new Error('Missing required environment variable: PROJECT_ID or GOOGLE_CLOUD_PROJECT');
  }
}

function setupGracefulShutdown(server, pool) {
  // Remove existing listeners
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutdown signal received, closing server...');
    
    try {
      await promisify(server.close.bind(server))();
      logger.info('Server closed');
      
      if (pool) {
        await pool.end();
        logger.info('Database pool closed');
      }
      
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function startServer() {
  try {
    validateEnvironment();
    
    logger.debug({
      phase: 'startup',
      node_env: process.env.NODE_ENV,
      project_id: process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
      parser_base_url: process.env.PARSER_BASE_URL,
      log_level: process.env.LOG_LEVEL
    }, 'Starting server with environment configuration');

    // Initialize Secret Manager
    logger.debug('Initializing Secret Manager');
    await initializeSecrets();
    logger.debug('Secret Manager initialized');

    // Initialize PubSub
    logger.debug('Initializing PubSub');
    await initializePubSub();
    logger.debug('PubSub initialized');

    // Check if we're in development mode
    const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    
    // Initialize database connection pool
    logger.debug('Initializing database pool');
    try {
      pool = await initializePool();
      
      // Test the database connection
      const client = await pool.connect();
      client.release();
      logger.info('Successfully connected to database');
    } catch (dbError) {
      logger.warn('Failed to connect to database', {
        code: dbError.code,
        phase: 'database_initialization',
        error: dbError.message,
        environment: process.env.NODE_ENV
      });
      
      // In development, create a mock pool for non-critical operations
      if (isDevelopment) {
        mockDatabaseMode = true;
        pool = createMockPool();
        logger.info('Created mock database pool for development mode');
      } else {
        // In production, we should not continue without a database
        logger.error('Database connection is required in production mode', {
          error: dbError.message
        });
        throw dbError;
      }
    }
    
    // Initialize Express app
    const app = express();
    
    // Store mock database mode in app state
    app.locals.mockDatabaseMode = mockDatabaseMode;
    
    app.use(expressLogger);
    app.use(express.json());

    let parserApiKey;
    try {
      parserApiKey = await getSecret('PARSER_API_KEY');
      logger.debug('Parser API key retrieved');
    } catch (error) {
      logger.warn('Parser API key not found, continuing without it');
      parserApiKey = null;
    }

    const subscriptionProcessor = new SubscriptionProcessor(pool, parserApiKey);
    logger.info('Subscription processor initialized');

    // Add middleware to check mock database status before registering routes
    app.use((req, res, next) => {
      if (mockDatabaseMode && 
          (req.path.includes('/process-subscription') || 
           req.path.includes('/process-subscriptions'))) {
        logger.warn('Attempt to process subscription with mock database', {
          path: req.path,
          method: req.method
        });
        return res.status(503).json({
          status: 'error',
          error: 'Database unavailable',
          message: 'The subscription worker is running in mock database mode. Please ensure PostgreSQL is running and accessible.',
          request_path: req.path
        });
      }
      next();
    });

    // Register routes
    app.use(createHealthRouter(pool));
    app.use(createSubscriptionRouter(subscriptionProcessor));
    app.use('/boe', createBOERouter(parserApiKey));
    logger.info('Routes registered');

    // Add error handling middleware
    app.use((err, req, res, next) => {
      logger.error({ 
        error: err,
        url: req.url,
        method: req.method
      }, 'Unhandled error in request');
      
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    });

    // Start server
    const port = process.env.PORT || 8080;
    const server = app.listen(port, () => {
      logger.info({ 
        phase: 'server_started',
        port,
        node_env: process.env.NODE_ENV,
        project_id: process.env.PROJECT_ID,
        mode: isDevelopment ? 'development' : 'production'
      }, 'Server started successfully');
    });
    
    setupGracefulShutdown(server, pool);
    
    return { server, pool };
  } catch (error) {
    logger.error('Failed to start server', {
      error,
      stack: error.stack
    });
    process.exit(1);
  }
}

/**
 * Creates a mock database pool for development mode when real database is unavailable
 * This mock pool provides appropriate mock implementations and clear error messages
 * @returns {Object} A mock pool that simulates a Postgres pool
 */
function createMockPool() {
  logger.debug('Creating mock database pool');
  
  // Create a mock client that throws clear errors
  const createMockClient = () => {
    return {
      query: () => {
        throw new Error('Mock database client cannot execute queries. Please ensure PostgreSQL is running.');
      },
      release: () => {
        logger.debug('Mock client released');
      }
    };
  };
  
  // Return a mock pool with implementations that will fail gracefully with informative errors
  return {
    totalCount: 5,
    idleCount: 5, 
    waitingCount: 0,
    
    connect: async () => {
      logger.debug('Mock database connect called');
      if (Math.random() < 0.3) {
        // Sometimes throw to simulate transient errors
        throw new Error('Mock database connection temporarily unavailable (simulated error)');
      }
      return createMockClient();
    },
    
    query: async () => {
      logger.debug('Mock database query called');
      throw new Error('Mock database pool cannot execute queries. Please ensure PostgreSQL is running.');
    },
    
    on: (event, callback) => {
      logger.debug(`Mock pool registered event listener for: ${event}`);
      // If it's an error event, we could simulate by calling the callback
      // if (event === 'error' && Math.random() < 0.1) {
      //   callback(new Error('Mock pool simulated error'));
      // }
      return this;
    },
    
    end: async () => {
      logger.debug('Mock pool end called');
      return Promise.resolve();
    },
    
    // Flag to identify this as a mock pool
    _mockPool: true
  };
}

// Global error handlers
const handleFatalError = (error, type) => {
  logger.fatal({
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

startServer();