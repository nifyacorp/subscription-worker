const axios = require('axios');
const BaseProcessor = require('./base');

const BOE_PARSER_URL = 'https://boe-parser-415554190254.us-central1.run.app';

class BOEProcessor extends BaseProcessor {
  constructor(config) {
    super(config);
    
    const baseURL = BOE_PARSER_URL;
    this.logger.debug({ baseURL }, 'Initializing BOE processor with service URL');
    
    this.client = axios.create({
      baseURL,
      timeout: 120000, // 2 minute timeout
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` })
      }
    });

    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second between retries

    // Add request interceptor for logging
    this.client.interceptors.request.use((config) => {
      this.logger.debug({
        method: config.method,
        url: config.url,
        baseURL: config.baseURL,
        headers: config.headers,
        data: config.data
      }, 'Outgoing request');
      return config;
    });

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        this.logger.debug({
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data_preview: {
            query_date: response.data?.query_date,
            results_count: response.data?.results?.length
          }
        }, 'Response received');
        return response;
      },
      (error) => {
        this.logger.error({
          error: {
            name: error.name,
            message: error.message,
            code: error.code,
            response: error.response ? {
              status: error.response.status,
              statusText: error.response.statusText,
              data: error.response.data,
              headers: error.response.headers
            } : undefined
          }
        }, 'Request failed');
        throw error;
      }
    );
  }

  async analyzeContent(prompts) {
    // Handle both array of strings and object with prompts
    const { prompts: promptsToAnalyze, user_id, subscription_id } = 
      Array.isArray(prompts) ? { prompts } : prompts;

    let retries = 0;
    let lastError = null;

    while (retries < this.maxRetries) {
      try {
        const texts = Array.isArray(promptsToAnalyze) ? promptsToAnalyze : [promptsToAnalyze];
        
        if (!texts.length) {
          throw new Error('No prompts provided for analysis');
        }

        const requestStartTime = Date.now();

        this.logger.debug({ 
          texts,
          user_id,
          subscription_id,
          attempt: retries + 1,
          max_retries: this.maxRetries,
          baseURL: this.client.defaults.baseURL
        }, 'Starting BOE content analysis');

        const requestPayload = {
          texts,
          metadata: {
            user_id,
            subscription_id
          }
        };

        const response = await this.client.post('/analyze-text', requestPayload);
        
        if (!response.data || typeof response.data !== 'object') {
          throw new Error('Invalid response from BOE service: Empty or invalid response data');
        }

        const processingTime = Date.now() - requestStartTime;
        const result = {
          query_date: response.data.query_date,
          results: response.data.results,
          metadata: {
            ...response.data.metadata,
            processing_time_ms: processingTime,
            retries: retries,
            request_id: response.headers['x-request-id']
          }
        };

        this.validateResponse(result);

        this.logger.info({
          processingTime,
          matchesFound: result.results.length,
          retries,
          request_id: result.metadata.request_id
        }, 'BOE analysis completed');

        return result;
      } catch (error) {
        lastError = error;
        retries++;

        if (retries < this.maxRetries) {
          this.logger.warn({
            error: error.message,
            attempt: retries,
            max_retries: this.maxRetries,
            next_retry_in_ms: this.retryDelay
          }, 'Request failed, retrying...');

          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
          continue;
        }

        // Rethrow with more context after all retries are exhausted
        const errorMessage = error.response?.data?.error || error.message;
        const enhancedError = new Error(`BOE analysis failed: ${errorMessage}`);
        enhancedError.originalError = error;
        enhancedError.context = {
          request: {
            url: this.client.defaults.baseURL + '/analyze-text',
            payload: requestPayload
          },
          response: error.response?.data,
          status: error.response?.status,
          request_id: error.response?.headers?.['x-request-id'],
          retries,
          total_time: Date.now() - requestStartTime
        };
        throw enhancedError;
      }
    }
  }
}

module.exports = BOEProcessor;