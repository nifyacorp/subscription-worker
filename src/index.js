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
    // Initialize services
    logger.debug('Initializing services');
    const pool = await initializePool();
    const parserApiKey = await getSecret('PARSER_API_KEY');
    const subscriptionProcessor = new SubscriptionProcessor(pool, parserApiKey);

    // Initialize Express app
    const app = express();
    app.use(expressLogger);
    app.use(express.json());

    // Register routes
    app.use(createHealthRouter(pool));
    app.use(createSubscriptionRouter(subscriptionProcessor));

    // Start server
    const port = process.env.PORT || 8080;
    app.listen(port, () => {
      logger.info({ port }, 'Server started successfully');
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

startServer();