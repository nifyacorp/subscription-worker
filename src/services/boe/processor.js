const axios = require('axios');
const { getLogger } = require('../../config/logger');

const logger = getLogger('boe-processor');

class BOEProcessor {
  constructor(apiKey, baseURL = process.env.PARSER_BASE_URL) {
    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
      }
    });
  }

  async analyzeContent(prompts) {
    try {
      logger.debug({ prompts }, 'Starting BOE content analysis');
      const startTime = Date.now();

      const response = await this.client.post('/analyze-text', {
        texts: prompts
      });

      const processingTime = Date.now() - startTime;
      logger.info({
        processingTime,
        matchesFound: response.data?.results?.length || 0
      }, 'BOE analysis completed');

      return {
        query_date: response.data.query_date,
        boe_info: response.data.boe_info,
        results: response.data.results,
        metadata: {
          ...response.data.metadata,
          processing_time_ms: processingTime
        }
      };
    } catch (error) {
      logger.error({
        error,
        prompts
      }, 'BOE analysis failed');
      throw error;
    }
  }
}

module.exports = BOEProcessor;