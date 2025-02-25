const axios = require('axios');
const BaseProcessor = require('./base');
const { getLogger } = require('../utils/logger');

const BOE_PARSER_URL = 'https://boe-parser-415554190254.us-central1.run.app';

class BOEProcessor extends BaseProcessor {
  constructor(config) {
    super();
    this.config = config;
    this.logger = getLogger('boe-processor');
    this.apiUrl = config.BOE_API_URL || 'https://boe-parser-biy2ojj42a-uc.a.run.app';
    this.apiKey = config.BOE_API_KEY || '';
    
    // Log initialization
    this.logger.debug('BOE Processor initialized', { 
      api_url: this.apiUrl,
      api_key_present: !!this.apiKey,
      config_keys: Object.keys(config || {})
    });
    
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

  /**
   * Process a subscription request - this is the main entry point
   * This method handles the processing of a subscription, handling empty requests gracefully
   * 
   * @param {Object} subscription - The subscription to process
   * @returns {Promise<Object>} The processing result
   */
  async processSubscription(subscription) {
    // Validate the subscription input
    if (!subscription) {
      this.logger.error('Subscription is null or undefined');
      throw new Error('Cannot process null or undefined subscription');
    }
    
    this.logger.debug('Processing BOE subscription', {
      subscription_id: subscription.subscription_id,
      user_id: subscription.user_id,
      prompts: Array.isArray(subscription.prompts) ? subscription.prompts : 'not an array',
      subscription_fields: Object.keys(subscription || {})
    });
    
    // Extract prompts from the subscription
    let prompts = [];
    if (Array.isArray(subscription.prompts) && subscription.prompts.length > 0) {
      prompts = subscription.prompts;
    } else if (subscription.metadata && Array.isArray(subscription.metadata.prompts)) {
      prompts = subscription.metadata.prompts;
    } else {
      this.logger.warn('No prompts found in subscription', {
        subscription_id: subscription.subscription_id,
        subscription_data: JSON.stringify(subscription).substring(0, 200) + '...'
      });
    }
    
    // If still no prompts, use a default
    if (!prompts.length) {
      this.logger.warn('Using default prompt as none was provided', {
        subscription_id: subscription.subscription_id
      });
      prompts = ['Información general del BOE'];
    }
    
    try {
      // Analyze BOE content based on prompts
      const analysisResult = await this.analyzeContent(prompts);
      
      this.logger.info('BOE analysis completed successfully', {
        subscription_id: subscription.subscription_id,
        result_count: analysisResult?.entries?.length || 0
      });
      
      return analysisResult;
    } catch (error) {
      this.logger.error('Error processing BOE subscription', {
        subscription_id: subscription.subscription_id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Analyze BOE content based on provided prompts
   * @param {Array<string>} prompts - The search prompts
   * @returns {Promise<Object>} The analysis result
   */
  async analyzeContent(prompts) {
    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
      this.logger.warn('No prompts provided for BOE analysis, using default');
      prompts = ['Información general del BOE'];
    }
    
    this.logger.debug('Analyzing BOE content', { prompts });
    
    try {
      const requestBody = {
        prompts: prompts,
        limit: 5,
        date: new Date().toISOString().split('T')[0] // Today's date in YYYY-MM-DD format
      };
      
      this.logger.debug('Sending request to BOE API', {
        endpoint: `${this.apiUrl}/analyze`,
        body: JSON.stringify(requestBody),
        api_key_present: !!this.apiKey,
        request_data: {
          url: `${this.apiUrl}/analyze`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey ? this.apiKey.substring(0, 3) + '...' : 'not-set'
          }
        }
      });
      
      // Make the request to the BOE API
      const response = await axios.post(
        `${this.apiUrl}/analyze`, 
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey
          },
          timeout: 30000 // 30 second timeout
        }
      );
      
      this.logger.debug('Received response from BOE API', {
        status: response.status,
        data_size: JSON.stringify(response.data).length,
        entries_count: response.data?.entries?.length || 0
      });
      
      return response.data;
    } catch (error) {
      this.logger.error('Error analyzing BOE content', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data ? JSON.stringify(error.response.data).substring(0, 200) : 'No response data',
        request: {
          url: error.config?.url,
          method: error.config?.method,
          data: error.config?.data ? JSON.stringify(error.config.data).substring(0, 200) : 'No request data'
        }
      });
      
      throw new Error(`BOE analysis failed: ${error.message}`);
    }
  }
}

module.exports = BOEProcessor;