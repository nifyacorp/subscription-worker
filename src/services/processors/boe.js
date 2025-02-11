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
    const requestStartTime = Date.now();

    try {
      this.logger.debug({ 
        prompts: promptsToAnalyze,
        user_id,
        subscription_id,
        baseURL: this.client.defaults.baseURL,
        headers: this.client.defaults.headers
      }, 'Starting BOE content analysis');

      const requestPayload = {
        texts: Array.isArray(promptsToAnalyze) ? promptsToAnalyze : [promptsToAnalyze],
        context: {
          user_id,
          subscription_id
        }
      };

      this.logger.debug({ 
        requestPayload,
        endpoint: '/analyze-text'
      }, 'Sending request to BOE service');

      const response = await this.client.post('/analyze-text', requestPayload);

      this.logger.debug({ 
        responseStatus: response.status,
        responseHeaders: response.headers,
        responseData: response.data,
        responseTime: Date.now() - requestStartTime
      }, 'Received response from BOE service');

      const processingTime = Date.now() - requestStartTime;
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
        error: {
          name: error.name,
          message: error.message,
          code: error.code,
          stack: error.stack,
          config: error.config ? {
            url: error.config.url,
            method: error.config.method,
            headers: error.config.headers,
            data: error.config.data
          } : undefined,
          response: error.response ? {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
            headers: error.response.headers
          } : undefined
        },
        request: {
          baseURL: this.client.defaults.baseURL,
          headers: this.client.defaults.headers,
          payload: {
            texts: Array.isArray(promptsToAnalyze) ? promptsToAnalyze : [promptsToAnalyze],
            context: { user_id, subscription_id }
          }
        },
        timing: {
          started_at: new Date(requestStartTime).toISOString(),
          duration_ms: Date.now() - requestStartTime
        },
        prompts: promptsToAnalyze,
        user_id,
        subscription_id
      }, 'BOE analysis failed');
      
      // Rethrow with more context
      const enhancedError = new Error(`BOE analysis failed: ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.context = {
        request: {
          url: this.client.defaults.baseURL + '/analyze-text',
          payload: requestPayload
        },
        response: error.response?.data
      };
      throw enhancedError;
      throw error;
    }
  }
}

module.exports = BOEProcessor;