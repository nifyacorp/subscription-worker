const { Pool } = require('pg');
const { getLogger } = require('./logger');
const { getSecret } = require('./secrets');

const logger = getLogger('database');

const INSTANCE_CONNECTION_NAME = process.env.PROJECT_ID 
  ? `${process.env.PROJECT_ID}:us-central1:nifya-db`
  : 'delta-entity-447812-p2:us-central1:nifya-db';

async function createPoolConfig() {
  logger.debug('Starting secrets retrieval from Secret Manager');
  const secretsStartTime = Date.now();
  
  const [dbName, dbUser, dbPassword] = await Promise.all([
    getSecret('DB_NAME'),
    getSecret('DB_USER'),
    getSecret('DB_PASSWORD'),
  ]);
  
  logger.debug({
    secrets_retrieval_time: Date.now() - secretsStartTime,
    secrets_retrieved: ['DB_NAME', 'DB_USER', 'DB_PASSWORD']
  }, 'Completed secrets retrieval');

  return {
    user: dbUser,
    password: dbPassword,
    database: dbName,
    ...(process.env.NODE_ENV === 'production' ? {
      host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      application_name: 'subscription-processor',
      statement_timeout: 10000,
      query_timeout: 10000,
      keepalive: true,
      keepaliveInitialDelayMillis: 10000
    } : {
      host: 'localhost',
      port: 5432
    })
  };
}

async function testDatabaseConnection(pool) {
  const client = await pool.connect();
  try {
    const [versionResult, settingsResult, tablesResult] = await Promise.all([
      client.query('SELECT version()'),
      client.query('SHOW ALL'),
      client.query(`
        SELECT table_name, 
               (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
        FROM information_schema.tables t
        WHERE table_schema = 'public'
      `)
    ]);

    return {
      version: versionResult.rows[0].version,
      tables: tablesResult.rows,
      settings: settingsResult.rows
    };
  } finally {
    client.release();
  }
}

async function initializePool() {
  try {
    logger.debug({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      memory_usage: process.memoryUsage(),
    }, 'Starting database pool initialization');

    const poolConfig = await createPoolConfig();
    logger.debug({ poolConfig }, 'Database configuration prepared');

    const poolStartTime = Date.now();
    const pool = new Pool(poolConfig);
    
    const connectionInfo = await testDatabaseConnection(pool);
    logger.debug({ connectionInfo }, 'Database connection test completed');

    pool.on('error', (err, client) => {
      logger.error({ 
        error: err,
        client_active: !!client,
        pool_stats: {
          total_count: pool.totalCount,
          idle_count: pool.idleCount,
          waiting_count: pool.waitingCount
        }
      }, 'Unexpected error on idle client');
    });

    return pool;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize database pool');
    throw error;
  }
}

module.exports = {
  initializePool,
  INSTANCE_CONNECTION_NAME
};