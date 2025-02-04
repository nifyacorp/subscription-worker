const express = require('express');
const expressPino = require('express-pino-logger');
require('dotenv').config();

const { getLogger } = require('./config/logger');
const { initializePool } = require('./config/database');
const { getSecret } = require('./config/secrets');
const SubscriptionProcessor = require('./services/subscriptionProcessor');
const createHealthRouter = require('./routes/health');
const createSubscriptionRouter = require('./routes/subscriptions');

const logger = getLogger('server');
const expressLogger = expressPino({ logger });

async function startServer() {
  try {
    logger.debug({
      node_env: process.env.NODE_ENV,
      project_id: process.env.PROJECT_ID,
      parser_base_url: process.env.PARSER_BASE_URL,
      log_level: process.env.LOG_LEVEL
    }, 'Starting server with environment configuration');

    // Initialize services
    logger.debug('Initializing database pool');
    const pool = await initializePool();
    logger.debug('Database pool initialized');

    logger.debug('Retrieving parser API key');
    const parserApiKey = await getSecret('PARSER_API_KEY');
    logger.debug('Parser API key retrieved');

    const subscriptionProcessor = new SubscriptionProcessor(pool, parserApiKey);
    logger.debug('Subscription processor initialized');

    // Initialize Express app
    const app = express();
    app.use(expressLogger);
    app.use(express.json());

    // Register routes
    app.use(createHealthRouter(pool));
    app.use(createSubscriptionRouter(subscriptionProcessor));
    logger.debug('Routes registered');

    // Start server
    const port = process.env.PORT || 8080;
    app.listen(port, () => {
      logger.info({ 
        port,
        node_env: process.env.NODE_ENV,
        project_id: process.env.PROJECT_ID
      }, 'Server started successfully');
    });
  } catch (error) {
    logger.error({ 
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

// Add uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.fatal({
    error,
    errorName: error.name,
    errorCode: error.code,
    errorStack: error.stack,
    errorMessage: error.message
  }, 'Uncaught exception detected');
  process.exit(1);
});

// Add unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({
    reason,
    reasonName: reason?.name,
    reasonCode: reason?.code,
    reasonStack: reason?.stack,
    reasonMessage: reason?.message
  }, 'Unhandled rejection detected');
  process.exit(1);
});

startServer();