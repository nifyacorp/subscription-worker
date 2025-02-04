const express = require('express');
const expressPino = require('express-pino-logger');
const { promisify } = require('util');
require('dotenv').config();

const { getLogger } = require('./config/logger');
const { initializePool } = require('./config/database');
const { getSecret, initialize: initializeSecrets } = require('./config/secrets');
const SubscriptionProcessor = require('./services/subscriptionProcessor');
const createHealthRouter = require('./routes/health');
const createSubscriptionRouter = require('./routes/subscriptions');

const REQUIRED_ENV_VARS = ['PROJECT_ID', 'PARSER_BASE_URL'];
const logger = getLogger('server');
const expressLogger = expressPino({ logger });

function validateEnvironment() {
  const missingVars = REQUIRED_ENV_VARS.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
}

function setupGracefulShutdown(server, pool) {
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
      project_id: process.env.PROJECT_ID,
      parser_base_url: process.env.PARSER_BASE_URL,
      log_level: process.env.LOG_LEVEL
    }, 'Starting server with environment configuration');

    // Initialize Secret Manager
    logger.debug('Initializing Secret Manager');
    await initializeSecrets();
    logger.debug('Secret Manager initialized');

    // Initialize services
    logger.debug('Initializing database pool');
    const pool = await initializePool();
    logger.debug('Database pool initialized');

    logger.debug('Retrieving parser API key');
    const parserApiKey = await getSecret('PARSER_API_KEY');
    logger.debug('Parser API key retrieved');

    const subscriptionProcessor = new SubscriptionProcessor(pool, parserApiKey);
    logger.info('Subscription processor initialized');

    // Initialize Express app
    const app = express();
    app.use(expressLogger);
    app.use(express.json());

    // Register routes
    app.use(createHealthRouter(pool));
    app.use(createSubscriptionRouter(subscriptionProcessor));
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
        project_id: process.env.PROJECT_ID
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