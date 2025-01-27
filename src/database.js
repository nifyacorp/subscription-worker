import pg from 'pg';
const { Pool } = pg;

let pool;

const RETRY_LIMIT = 5;
const RETRY_DELAY = 1000; // 1 second
const POOL_CONFIG = {
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
};

async function createPool() {
  return new Pool({
    host: '/cloudsql/delta-entity-447812-p2:us-central1:nifya-db',
    database: 'nifya',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ...POOL_CONFIG
  });
}

async function testConnection(attempt = 1) {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT NOW()');
      console.log('✅ Database connection test successful');
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`❌ Connection test failed (attempt ${attempt}):`, error.message);
    
    if (attempt < RETRY_LIMIT) {
      console.log(`🔄 Retrying in ${RETRY_DELAY}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return testConnection(attempt + 1);
    }
    
    throw new Error(`Failed to connect after ${RETRY_LIMIT} attempts`);
  }
}

export async function initializeDatabase() {
  console.log('🔄 Initializing database connection...');
  
  try {
    pool = await createPool();
    
    // Set up error handling for the pool
    pool.on('error', (err, client) => {
      console.error('🚨 Unexpected error on idle client:', err);
    });

    pool.on('connect', () => {
      console.log('📡 New client connected to database');
    });

    pool.on('remove', () => {
      console.log('🔌 Client removed from pool');
    });

    // Test initial connection with retry logic
    await testConnection();
    
    console.log('✅ Database pool initialized successfully');
    return pool;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
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