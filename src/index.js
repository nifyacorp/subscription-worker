const express = require('express');
const pino = require('pino');
const expressPino = require('express-pino-logger');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
require('dotenv').config();

// Cloud SQL instance connection name
const INSTANCE_CONNECTION_NAME = 'delta-entity-447812-p2:us-central1:nifya-db';

// Initialize Secret Manager client
const secretManager = new SecretManagerServiceClient();

// Initialize logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

// Express middleware logger
const expressLogger = expressPino({ logger });

async function getSecret(secretName) {
  try {
    logger.debug({ secretName }, 'Retrieving secret');
    const [version] = await secretManager.accessSecretVersion({
      name: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`,
    });
    logger.debug({ secretName }, 'Successfully retrieved secret');
    return version.payload.data.toString();
  } catch (error) {
    logger.error({ error, secretName }, 'Failed to retrieve secret');
    throw error;
  }
}

async function initializePool() {
  try {
    logger.debug('Starting database pool initialization');
    
    // Log Secret Manager project details
    logger.debug({ 
      project_id: process.env.PROJECT_ID,
      instance_connection: INSTANCE_CONNECTION_NAME 
    }, 'Secret Manager configuration');

    // Get secrets with detailed logging
    logger.debug('Retrieving database credentials from Secret Manager');
    const [dbName, dbUser, dbPassword] = await Promise.all([
      getSecret('DB_NAME'),
      getSecret('DB_USER'),
      getSecret('DB_PASSWORD'),
    ]);

    logger.debug({ 
      dbName,
      dbUser,
      host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
      has_password: !!dbPassword
    }, 'Database configuration loaded');

    // Create pool with detailed configuration logging
    logger.debug('Creating database connection pool');
    const pool = new Pool({
      user: dbUser,
      password: dbPassword,
      database: dbName,
      host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
    });

    // Test connection with enhanced logging
    logger.debug('Testing database connection');
    const client = await pool.connect();
    try {
      // Log pool status
      logger.debug({
        total_count: pool.totalCount,
        idle_count: pool.idleCount,
        waiting_count: pool.waitingCount
      }, 'Pool statistics before test query');

      const result = await client.query('SELECT version(), current_database(), current_user');
      logger.debug({ 
        pg_version: result.rows[0].version,
        database: result.rows[0].current_database,
        user: result.rows[0].current_user,
        timestamp: new Date().toISOString()
      }, 'Database connection successful');

      // Additional connection test
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'subscription_processing'
        );
      `);
      
      logger.debug({ 
        subscription_table_exists: tableCheck.rows[0].exists 
      }, 'Schema validation');

    } finally {
      client.release();
      logger.debug('Test connection released');
    }

    return pool;
  } catch (error) {
    logger.error({ 
      error,
      error_code: error.code,
      error_detail: error.detail,
      connection_name: INSTANCE_CONNECTION_NAME,
      stack: error.stack
    }, 'Failed to initialize database pool');
    throw error;
  }
}

// Initialize Express app
const app = express();
app.use(expressLogger);
app.use(express.json());

let pool;

// Health check endpoint with DB check
app.get('/_health', async (req, res) => {
  try {
    if (!pool) {
      logger.debug('Initializing pool for health check');
      pool = await initializePool();
    }
    
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      res.status(200).json({ status: 'healthy', database: 'connected' });
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error({ error }, 'Health check failed');
    res.status(500).json({ 
      status: 'unhealthy', 
      database: 'disconnected',
      error: error.message 
    });
  }
});

// Subscription processing endpoint
app.post('/process-subscriptions', async (req, res) => {
  try {
    await processSubscriptions();
    res.status(200).json({ status: 'success' });
  } catch (error) {
    logger.error({ error }, 'Failed to process subscriptions');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Main processing function
async function processSubscriptions() {
  if (!pool) {
    logger.debug('Initializing pool for subscription processing');
    pool = await initializePool();
  }
  
  const client = await pool.connect();
  logger.debug('Acquired database client');
  
  try {
    await client.query('BEGIN');
    logger.debug('Started database transaction');

    // Get pending subscriptions
    const result = await client.query(`
      SELECT * FROM subscription_processing
      WHERE status = 'pending'
      AND next_run_at <= NOW()
      FOR UPDATE SKIP LOCKED
    `);

    const subscriptions = result.rows;
    logger.debug({ count: subscriptions.length }, 'Retrieved pending subscriptions');
    
    // Log the first subscription details if available
    if (subscriptions.length > 0) {
      const firstSub = subscriptions[0];
      logger.debug({
        subscription_id: firstSub.subscription_id,
        last_run_at: firstSub.last_run_at,
        next_run_at: firstSub.next_run_at,
        status: firstSub.status,
        error: firstSub.error,
        metadata: firstSub.metadata
      }, 'First pending subscription details');
    }
    
    // Group subscriptions by type
    const grouped = subscriptions.reduce((acc, sub) => {
      const type = sub.metadata?.type || 'unknown';
      acc[type] = acc[type] || [];
      acc[type].push(sub);
      return acc;
    }, {});

    // Process each group
    for (const [type, subs] of Object.entries(grouped)) {
      logger.info({ type, count: subs.length }, 'Processing subscription group');
      
      for (const sub of subs) {
        try {
          // Update status to processing
          await client.query(`
            UPDATE subscription_processing
            SET status = 'processing',
                last_run_at = NOW()
            WHERE subscription_id = $1
          `, [sub.subscription_id]);
          logger.debug({ subscriptionId: sub.subscription_id }, 'Updated subscription status to processing');

          // Process based on type
          let parserResult;
          if (type === 'BOE') {
            parserResult = await callParserWithRetry('boe', sub);
          } else if (type === 'Real Estate') {
            parserResult = await callParserWithRetry('real-estate', sub);
          }

          // Create notification
          await client.query(`
            INSERT INTO notifications (subscription_id, content, created_at)
            VALUES ($1, $2, NOW())
          `, [sub.subscription_id, JSON.stringify(parserResult)]);
          logger.debug({ subscriptionId: sub.subscription_id }, 'Created notification');

          // Update processing status
          await client.query(`
            UPDATE subscription_processing
            SET status = 'completed',
                next_run_at = NOW() + INTERVAL '5 minutes',
                error = NULL
            WHERE subscription_id = $1
          `, [sub.subscription_id]);
          logger.debug({ subscriptionId: sub.subscription_id }, 'Updated subscription status to completed');

        } catch (error) {
          logger.error({ error, subscriptionId: sub.subscription_id }, 'Failed to process subscription');
          
          // Update error status
          await client.query(`
            UPDATE subscription_processing
            SET status = 'failed',
                error = $1,
                next_run_at = NOW() + INTERVAL '5 minutes'
            WHERE subscription_id = $2
          `, [error.message, sub.subscription_id]);
          logger.debug({ subscriptionId: sub.subscription_id }, 'Updated subscription status to failed');
        }
      }
    }

    await client.query('COMMIT');
    logger.debug('Committed database transaction');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.debug('Rolled back database transaction');
    throw error;
  } finally {
    client.release();
    logger.debug('Released database client');
  }
}

// Retry mechanism for parser calls
async function callParserWithRetry(parserType, subscription, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`${process.env.PARSER_BASE_URL}/${parserType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(subscription),
      });

      if (!response.ok) {
        throw new Error(`Parser service returned ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
}

// Start server
const port = process.env.PORT || 8080;
app.listen(port, async () => {
  try {
    // Initialize the pool on startup
    logger.debug('Initializing database pool on server startup');
    pool = await initializePool();
    logger.info({ port }, 'Server started successfully with database connection');
  } catch (error) {
    logger.error({ 
      error,
      errorCode: error.code,
      errorDetail: error.detail,
      connectionName: INSTANCE_CONNECTION_NAME
    }, 'Failed to start server - database connection failed');
    process.exit(1);
  }
});