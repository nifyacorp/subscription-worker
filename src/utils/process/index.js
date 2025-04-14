/**
 * Process utilities module
 * Handles process-level operations such as graceful shutdown
 */

const { setupGracefulShutdown } = require('./shutdown');

module.exports = {
  setupGracefulShutdown
}; 