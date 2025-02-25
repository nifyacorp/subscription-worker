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
        data: config.data,
        data_json: JSON.stringify(config.data)
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
          },
          response_data: response.data ? JSON.stringify(response.data).substring(0, 500) : null
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
          },
          request_data: error.config ? JSON.stringify(error.config.data) : null
        }, 'Request failed');
        throw error;
      }
    );
  }

  // Nuevo método para manejar solicitudes de procesamiento de suscripciones
  async processSubscription(subscription) {
    if (!subscription) {
      this.logger.error({ error: 'No subscription provided' }, 'Null or undefined subscription object');
      throw new Error('Cannot process null or undefined subscription');
    }
    
    this.logger.debug({
      subscription_id: subscription.subscription_id,
      metadata: subscription.metadata ? JSON.stringify(subscription.metadata) : null,
      prompts: subscription.prompts,
      method: 'processSubscription',
      phase: 'start'
    }, 'Processing subscription');
    
    try {
      // Si la suscripción no tiene prompts, utilizamos un valor por defecto para evitar errores
      const prompts = subscription.prompts || ['default_prompt_for_empty_requests'];
      
      const result = await this.analyzeContent({
        prompts: prompts,
        user_id: subscription.metadata?.user_id,
        subscription_id: subscription.subscription_id
      });
      
      this.logger.debug({
        subscription_id: subscription.subscription_id,
        results_length: result?.results?.length || 0,
        method: 'processSubscription',
        phase: 'complete'
      }, 'Subscription processing completed');
      
      return result;
    } catch (error) {
      this.logger.error({
        error,
        message: error.message,
        stack: error.stack,
        subscription_id: subscription.subscription_id,
        method: 'processSubscription',
        phase: 'error'
      }, 'Subscription processing failed');
      throw error;
    }
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
          this.logger.warn({
            subscription_id,
            user_id,
            method: 'analyzeContent'
          }, 'No prompts provided for analysis, using default');
          texts.push('default_prompt_for_empty_requests');
        }

        const requestStartTime = Date.now();

        this.logger.debug({ 
          texts,
          user_id,
          subscription_id,
          attempt: retries + 1,
          max_retries: this.maxRetries,
          baseURL: this.client.defaults.baseURL,
          phase: 'analyze_content_start'
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
          request_id: result.metadata.request_id,
          phase: 'analyze_content_complete'
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

        // Log full request details on final failure
        this.logger.error({
          error: lastError,
          message: lastError.message,
          stack: lastError.stack,
          subscription_id,
          user_id,
          texts: Array.isArray(promptsToAnalyze) ? promptsToAnalyze : [promptsToAnalyze],
          retries,
          phase: 'analyze_content_failed'
        }, 'BOE analysis failed after all retries');

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
          retries
        };
        throw enhancedError;
      }
    }
  }
}

module.exports = BOEProcessor;