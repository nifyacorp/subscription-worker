const { getLogger } = require('../../config/logger');

class BaseProcessor {
  constructor(config = {}) {
    this.logger = getLogger(this.constructor.name.toLowerCase());
    this.config = config;
  }

  async analyzeContent(prompts) {
    throw new Error('analyzeContent must be implemented by processor');
  }

  validateResponse(response) {
    const requiredFields = ['query_date', 'results', 'metadata'];
    const missingFields = requiredFields.filter(field => !response[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Invalid processor response. Missing fields: ${missingFields.join(', ')}`);
    }

    if (!Array.isArray(response.results)) {
      throw new Error('Invalid processor response. Results must be an array');
    }

    return true;
  }
}

module.exports = BaseProcessor;