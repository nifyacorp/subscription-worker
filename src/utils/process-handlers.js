/**
 * Process handlers for graceful shutdown and other process-related operations.
 */
const { promisify } = require('util');

/**
 * Sets up graceful shutdown handlers for the application
 * 
 * @param {object} server - The HTTP server instance to close
 * @param {object} pool - The database pool to close
 */
function setupGracefulShutdown(server, pool) {
  const signals = ['SIGINT', 'SIGTERM'];
  
  const shutdown = async (signal) => {
    console.info({ signal }, 'Shutdown signal received. Closing server gracefully...');
    
    try {
      // 1. Stop accepting new connections
      await promisify(server.close.bind(server))();
      console.info('HTTP server closed.');
      
      // 2. Close database pool
      if (pool && typeof pool.end === 'function') {
        await pool.end();
        console.info('Database pool closed.');
      } else {
        console.warn('Database pool not available or cannot be closed during shutdown.');
      }
      
      // 3. Add cleanup for other resources if needed (e.g., PubSub clients)

      console.info('Graceful shutdown complete. Exiting process.');
      process.exit(0);
    } catch (error) {
      console.error({ error: error.message, stack: error.stack }, 'Error during graceful shutdown');
      process.exit(1); // Exit with error code
    }
  };

  signals.forEach(signal => {
      process.removeAllListeners(signal); // Remove existing listeners first
      process.on(signal, () => shutdown(signal));
  });
  console.info('Graceful shutdown handlers configured.', { signals });
}

module.exports = {
  setupGracefulShutdown
}; 