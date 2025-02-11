const axios = require('axios');
const BaseProcessor = require('./base');

class BOEProcessor extends BaseProcessor {
  constructor(config) {
    super(config);
    
    const baseURL = 'https://boe-parser-415554190254.us-central1.run.app';
    this.logger.debug({ baseURL }, 'Initializing BOE processor with service URL');
    
    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` })
      }
    });
  }

  async analyzeContent(prompts) {
    const context = Array.isArray(prompts) ? prompts : { prompts };
    const { prompts: promptsToAnalyze, user_id, subscription_id } = context;

    try {
      this.logger.debug({ 
        prompts: promptsToAnalyze,
        user_id,
        subscription_id 
      }, 'Starting BOE content analysis');

      const startTime = Date.now();

      const response = await this.client.post('/analyze-text', {
        texts: Array.isArray(promptsToAnalyze) ? promptsToAnalyze : [promptsToAnalyze],
        context: {
          user_id,
          subscription_id
        }
      });

      const processingTime = Date.now() - startTime;
      const result = {
        query_date: response.data.query_date,
        results: response.data.results,
        metadata: {
          ...response.data.metadata,
          processing_time_ms: processingTime
        }
      };

      this.validateResponse(result);

      this.logger.info({
        processingTime,
        matchesFound: result.results.length
      }, 'BOE analysis completed');

      return result;
    } catch (error) {
      this.logger.error({
        error,
        prompts: promptsToAnalyze,
        user_id,
        subscription_id
      }, 'BOE analysis failed');
      throw error;
    }
  }
}

module.exports = BOEProcessor;