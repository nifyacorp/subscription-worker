const { Pool } = require('pg');
const { getLogger } = require('./logger');
const { getSecret } = require('./secrets');

const logger = getLogger('database');

// Check if running in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

const INSTANCE_CONNECTION_NAME = process.env.PROJECT_ID 
  ? `${process.env.PROJECT_ID}:us-central1:nifya-db` 
  : 'delta-entity-447812-p2:us-central1:nifya-db'; 

async function createPoolConfig() {
  logger.debug({
    instanceConnectionName: INSTANCE_CONNECTION_NAME,
    nodeEnv: process.env.NODE_ENV,
    projectId: process.env.PROJECT_ID,
    socketPath: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
    mode: isDevelopment ? 'development' : 'production'
  }, 'Starting pool configuration');

  try {
    let dbName, dbUser, dbPassword;

    if (isDevelopment) {
      // In development mode, use environment variables directly
      logger.debug('Using environment variables for database config in development mode');
      dbName = process.env.DB_NAME || 'nifya_db';
      dbUser = process.env.DB_USER || 'postgres';
      dbPassword = process.env.DB_PASSWORD || 'postgres';
      
      logger.debug({
        dbName,
        dbUser,
        dbPassword: dbPassword ? '********' : undefined,
        mode: 'development'
      }, 'Using development database configuration');
    } else {
      // In production, get secrets from Secret Manager
      logger.debug('Starting secrets retrieval from Secret Manager');
      const secretsStartTime = Date.now();
      
      [dbName, dbUser, dbPassword] = await Promise.all([
        getSecret('DB_NAME'),
        getSecret('DB_USER'),
        getSecret('DB_PASSWORD'),
      ]);
      
      logger.debug({
        secrets_retrieval_time: Date.now() - secretsStartTime,
        secrets_retrieved: ['DB_NAME', 'DB_USER', 'DB_PASSWORD'],
        dbNameLength: dbName?.length,
        dbUserLength: dbUser?.length,
        dbPasswordExists: !!dbPassword
      }, 'Completed secrets retrieval');
    }

    const config = {
      user: dbUser,
      password: dbPassword,
      database: dbName,
      ...(isDevelopment || process.env.NODE_ENV !== 'production' ? {
        host: 'localhost',
        port: 5432
      } : {
        host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        application_name: 'subscription-processor',
        statement_timeout: 10000,
        query_timeout: 10000,
        keepalive: true,
        keepaliveInitialDelayMillis: 10000
      })
    };

    logger.debug({
      host: config.host,
      database: config.database,
      user: config.user,
      max: config.max,
      idleTimeoutMillis: config.idleTimeoutMillis,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      environment: process.env.NODE_ENV,
      mode: isDevelopment ? 'development' : 'production',
      socketExists: !isDevelopment && process.env.NODE_ENV === 'production' ? 
        require('fs').existsSync(`/cloudsql/${INSTANCE_CONNECTION_NAME}`) : 'N/A'
    }, 'Pool configuration created');

    return config;
  } catch (error) {
    logger.error({
      error,
      errorName: error.name,
      errorCode: error.code,
      errorStack: error.stack,
      phase: 'createPoolConfig'
    }, 'Failed to create pool configuration');
    throw error;
  }
}

async function testDatabaseConnection(pool) {
  const startTime = Date.now();
  logger.info({
    phase: 'connection_test_start',
    timestamp: new Date().toISOString(),
    pool_config: {
      total_count: pool.totalCount,
      idle_count: pool.idleCount,
      waiting_count: pool.waitingCount
    }
  }, 'Starting database connection test');

  const client = await pool.connect();
  logger.info({
    phase: 'client_acquired',
    connection_time: Date.now() - startTime
  }, 'Successfully acquired database client');

  try {
    const testStartTime = Date.now();
    const [versionResult, tablesResult] = await Promise.all([
      client.query('SELECT version()'),
      client.query(`
        SELECT table_name, 
               (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
        FROM information_schema.tables t
        WHERE table_schema = 'public'
      `)
    ]);

    const testDuration = Date.now() - testStartTime;
    logger.info({
      phase: 'connection_test_success',
      testDuration,
      pgVersion: versionResult.rows[0]?.version,
      tableCount: tablesResult.rows?.length,
      tables: tablesResult.rows.map(r => r.table_name),
      total_duration: Date.now() - startTime
    }, 'Database connection test completed successfully');

    return {
      version: versionResult.rows[0]?.version,
      tables: tablesResult.rows
    };
  } catch (error) {
    logger.error({
      error,
      errorName: error.name,
      errorCode: error.code,
      errorStack: error.stack,
      phase: 'testDatabaseConnection'
    }, 'Database connection test failed');
    throw error;
  } finally {
    client.release();
  }
}

async function initializePool() {
  try {
    logger.info({
      phase: 'pool_initialization_start',
      timestamp: new Date().toISOString(),
      pid: process.pid,
      memory_usage: process.memoryUsage(),
      node_env: process.env.NODE_ENV,
      project_id: process.env.PROJECT_ID,
      instance_connection_name: INSTANCE_CONNECTION_NAME
    }, 'Starting database pool initialization');

    const poolConfig = await createPoolConfig();
    logger.info({
      phase: 'pool_config_created',
      config: {
        host: poolConfig.host,
        database: poolConfig.database,
        user: poolConfig.user,
        max: poolConfig.max,
        environment: process.env.NODE_ENV
      }
    }, 'Pool configuration created successfully');

    const poolStartTime = Date.now();
    const pool = new Pool(poolConfig);
    logger.info({
      phase: 'pool_instance_created',
      creation_time: Date.now() - poolStartTime
    }, 'Database pool instance created');
    
    const connectionInfo = await testDatabaseConnection(pool);
    logger.info({
      phase: 'pool_initialization_complete',
      poolCreationTime: Date.now() - poolStartTime,
      connectionInfo,
      pool_stats: {
        total_count: pool.totalCount,
        idle_count: pool.idleCount,
        waiting_count: pool.waitingCount
      }
    }, 'Database pool initialized successfully');

    pool.on('error', (err, client) => {
      logger.error({ 
        error: err,
        errorName: err.name,
        errorCode: err.code,
        errorStack: err.stack,
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
    logger.error({ 
      error,
      errorName: error.name,
      errorCode: error.code,
      errorMessage: error.message,
      errorStack: error.stack,
      errorMessage: error.message,
      phase: 'initializePool',
      instanceConnectionName: INSTANCE_CONNECTION_NAME,
      nodeEnv: process.env.NODE_ENV,
      projectId: process.env.PROJECT_ID,
      socketPath: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
      socketExists: process.env.NODE_ENV === 'production' ? 
        require('fs').existsSync(`/cloudsql/${INSTANCE_CONNECTION_NAME}`) : 'N/A'
    }, 'Failed to initialize database pool');
    throw error;
  }
}

module.exports = {
  initializePool,
  createPoolConfig,
  testDatabaseConnection
};