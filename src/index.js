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
    
    // Initialize services
    logger.debug('Initializing database pool');
    let pool;
    try {
      pool = await initializePool();
      logger.debug('Database pool initialized');
    } catch (error) {
      if (isDevelopment) {
        logger.warn({ 
          error: error.message,
          code: error.code,
          phase: 'database_initialization'
        }, 'Failed to connect to database in development mode, continuing with mock database');
        // Create a mock pool for development
        pool = {
          query: async () => {
            return { rows: [] };
          },
          connect: async () => {
            return {
              query: async () => {
                return { rows: [] };
              },
              release: () => {}
            };
          },
          end: async () => {}
        };
      } else {
        // In production, database is required
        throw error;
      }
    }

    // Make parser API key optional
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

    // Initialize Express app
    const app = express();
    app.use(expressLogger);
    app.use(express.json());

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
    logger.error({ 
      phase: 'startup_failed',
      error,
      errorName: error.name,
      errorCode: error.code,
      errorStack: error.stack,
      errorMessage: error.message,
      node_env: process.env.NODE_ENV,
      project_id: process.env.PROJECT_ID
    }, 'Failed to start server');
    process.exit(1);
  }
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