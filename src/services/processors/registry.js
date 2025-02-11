const BOEProcessor = require('./boe');
const { getLogger } = require('../../config/logger');

const logger = getLogger('processor-registry');

class ProcessorRegistry {
  constructor() {
    this.processors = new Map();
    this.registerDefaultProcessors();
  }

  registerDefaultProcessors() {
    // Register built-in processors
    this.register('boe', BOEProcessor);
  }

  register(type, ProcessorClass) {
    if (this.processors.has(type)) {
      throw new Error(`Processor type '${type}' is already registered`);
    }
    this.processors.set(type, ProcessorClass);
    logger.info({ type }, 'Registered new processor type');
  }

  createProcessor(type, config = {}) {
    const ProcessorClass = this.processors.get(type);
    if (!ProcessorClass) {
      throw new Error(`No processor registered for type: ${type}`);
    }
    return new ProcessorClass(config);
  }

  hasProcessor(type) {
    return this.processors.has(type);
  }

  getRegisteredTypes() {
    return Array.from(this.processors.keys());
  }
}

// Export singleton instance
module.exports = new ProcessorRegistry();