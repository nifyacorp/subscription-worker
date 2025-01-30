import pg from 'pg';
const { Pool } = pg;

// Hardcoded instance connection name
const INSTANCE_CONNECTION_NAME = 'delta-entity-447812-p2:us-central1:nifya-db';

// Pool configuration
const POOL_CONFIG = {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: false
};

let pool;

async function createPool() {
  // Log database configuration (excluding sensitive data)
  console.log('Database configuration:', {
    host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
    database: process.env.DB_NAME,
    hasUser: !!process.env.DB_USER,
    hasPassword: !!process.env.DB_PASSWORD,
    timestamp: new Date().toISOString()
  });

  return new Pool({
    host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ...POOL_CONFIG
  });
}

async function testConnection() {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT current_database() as db_name');
      console.log('Database connection verified:', {
        database: result.rows[0].db_name,
        poolSize: pool.totalCount,
        timestamp: new Date().toISOString()
      });
      console.log('Database connection established');
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Database query error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw new Error('Failed to initialize database: ' + error.message);
  }
}

export async function initializeDatabase() {
  console.log('🔄 Initializing database connection...');
  
  // Log environment check
  console.log('🔍 Checking database environment variables:', {
    hasInstanceConnection: true,
    hasDbName: !!process.env.DB_NAME,
    hasDbUser: !!process.env.DB_USER
  });

  try {
    pool = await createPool();
    
    // Set up error handling for the pool
    pool.on('error', (err, client) => {
      console.error('🚨 Unexpected error on idle client:', err);
    });

    pool.on('connect', (client) => {
      console.log('📡 New client connected to database:', client.processID);
    });

    pool.on('remove', (client) => {
      console.log('🔌 Client removed from pool');
    });

    // Test initial connection with retry logic
    await testConnection();
    
    console.log('✅ Database pool initialized successfully');
    return pool;
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message, '\nStack:', error.stack);
    throw error;
  }
}

export function getPool() {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  return pool;
}

// Graceful shutdown helper
export async function closePool() {
  if (pool) {
    console.log('🔄 Closing database pool...');
    await pool.end();
    console.log('✅ Database pool closed');
  }
}