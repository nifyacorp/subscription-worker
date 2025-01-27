import pg from 'pg';
const { Pool } = pg;

const POOL_CONFIG = {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
};

let pool;

async function createPool() {
  console.log('📝 Creating database pool with configuration:', {
    host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    max: POOL_CONFIG.max,
    idleTimeoutMillis: POOL_CONFIG.idleTimeoutMillis,
    connectionTimeoutMillis: POOL_CONFIG.connectionTimeoutMillis
  });

  return new Pool({
    host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ...POOL_CONFIG
  });
}

async function testConnection() {
  try {
    console.log('🔄 Testing database connection...');
    const client = await pool.connect();
    try {
      await client.query('SELECT NOW()');
      console.log('✅ Database connection test successful');
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Database connection test failed:', error.message, '\nError details:', error);
    throw error;
  }
}

export async function initializeDatabase() {
  console.log('🔄 Initializing database connection...');
  
  // Log environment check
  console.log('🔍 Checking database environment variables:', {
    hasInstanceConnection: !!process.env.INSTANCE_CONNECTION_NAME,
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