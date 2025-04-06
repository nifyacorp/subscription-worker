// Removed: const { getLogger } = require('../config/logger');

class ConfigService {
  constructor() {
    // Removed: this.logger = getLogger('config');
    this.loadConfig();
  }

  loadConfig() {
    // ... (load logic)
    // Removed: this.logger.info('Configuration loaded');
    console.info('Configuration loaded'); // Replace logger
  }

  // ... (get methods)
}

module.exports = new ConfigService(); 