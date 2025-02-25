const axios = require('axios');
const BaseProcessor = require('./base');
const { getLogger } = require('../../config/logger');

const BOE_PARSER_URL = 'https://boe-parser-415554190254.us-central1.run.app';

class BOEProcessor extends BaseProcessor {
  constructor(config) {
    super();
    this.config = config || {};
    this.logger = getLogger('boe-processor');
    
    this.logger.debug('BOE Processor constructor called', {
      has_config: !!config,
      config_type: typeof config,
      config_keys: config ? Object.keys(config) : []
    });
    
    this.apiUrl = config?.BOE_API_URL || BOE_PARSER_URL;
    this.apiKey = config?.BOE_API_KEY || '';
    
    // Log initialization with complete information
    this.logger.debug('BOE Processor configuration', { 
      api_url: this.apiUrl,
      api_key_present: !!this.apiKey,
      api_key_length: this.apiKey ? this.apiKey.length : 0,
      environment_api_url: process.env.BOE_API_URL,
      config_api_url: config?.BOE_API_URL,
      fallback_url: BOE_PARSER_URL
    });
    
    const baseURL = this.apiUrl; // Use the properly initialized apiUrl
    this.logger.debug({ baseURL }, 'Initializing BOE processor with service URL');
    
    this.client = axios.create({
      baseURL,
      timeout: 120000, // 2 minute timeout
      headers: {
        'Content-Type': 'application/json',
        ...(config.BOE_API_KEY && { 'x-api-key': config.BOE_API_KEY })
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
    
    // Extract user ID and subscription ID
    const subscription_id = subscription.subscription_id || subscription.id;
    const user_id = subscription.user_id;
    
    this.logger.debug('Processing BOE subscription', {
      subscription_id: subscription_id || 'unknown',
      user_id: user_id || 'unknown',
      subscription_type: typeof subscription,
      subscription_fields: Object.keys(subscription || {})
    });
    
    // Extract prompts from the subscription - handle all possible locations and missing data
    let prompts = [];
    
    try {
      if (Array.isArray(subscription.prompts) && subscription.prompts.length > 0) {
        prompts = subscription.prompts;
        this.logger.debug('Using prompts from subscription.prompts', { count: prompts.length });
      } else if (subscription.metadata && Array.isArray(subscription.metadata.prompts) && subscription.metadata.prompts.length > 0) {
        prompts = subscription.metadata.prompts;
        this.logger.debug('Using prompts from subscription.metadata.prompts', { count: prompts.length });
      } else {
        // Try to retrieve prompts from other places
        if (typeof subscription.prompts === 'string') {
          try {
            // Try to parse string as JSON
            const parsedPrompts = JSON.parse(subscription.prompts);
            if (Array.isArray(parsedPrompts) && parsedPrompts.length > 0) {
              prompts = parsedPrompts;
              this.logger.debug('Using prompts parsed from string', { count: prompts.length });
            }
          } catch (parseError) {
            // If it's not JSON, use the string as a single prompt
            prompts = [subscription.prompts];
            this.logger.debug('Using prompts string as single prompt');
          }
        }
      }
    } catch (promptError) {
      this.logger.error('Error extracting prompts from subscription', {
        error: promptError.message,
        subscription_preview: JSON.stringify(subscription).substring(0, 200) + '...'
      });
    }
    
    // If still no prompts, use a default
    if (!prompts.length) {
      const defaultPrompt = 'Información general del BOE';
      this.logger.warn('Using default prompt as none was provided', {
        subscription_id: subscription_id || 'unknown',
        default_prompt: defaultPrompt
      });
      prompts = [defaultPrompt];
    }
    
    try {
      // Analyze BOE content based on prompts
      this.logger.info('Sending prompts to BOE analyzer', {
        prompt_count: prompts.length,
        first_prompt: prompts[0],
        subscription_id,
        user_id
      });
      
      const analysisResult = await this.analyzeContent(prompts, subscription_id, user_id);
      
      this.logger.info('BOE analysis completed successfully', {
        subscription_id: subscription_id || 'unknown',
        result_count: analysisResult?.entries?.length || 0,
        status: analysisResult?.status || 'unknown'
      });
      
      return {
        status: 'success',
        timestamp: new Date().toISOString(),
        subscription_id: subscription_id || 'unknown',
        entries: analysisResult?.entries || [],
        matches: analysisResult?.entries || []
      };
    } catch (error) {
      this.logger.error('Error processing BOE subscription', {
        subscription_id: subscription_id || 'unknown',
        error: error.message,
        stack: error.stack
      });
      
      // Return a structured error response instead of throwing
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        subscription_id: subscription_id || 'unknown',
        error: error.message,
        entries: [],
        matches: []
      };
    }
  }
  
  /**
   * Analyze BOE content based on provided prompts
   * @param {Array<string>} prompts - The search prompts
   * @param {string} subscriptionId - The subscription ID
   * @param {string} userId - The user ID
   * @returns {Promise<Object>} The analysis result
   */
  async analyzeContent(prompts, subscriptionId, userId) {
    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
      this.logger.warn('No prompts provided for BOE analysis, using default');
      prompts = ['Información general del BOE'];
    }
    
    this.logger.debug('Analyzing BOE content', { 
      prompts,
      subscriptionId,
      userId 
    });
    
    try {
      const requestBody = {
        texts: prompts,
        metadata: {
          user_id: userId || 'system-user',
          subscription_id: subscriptionId || 'system-subscription',
        },
        limit: 5,
        date: new Date().toISOString().split('T')[0]
      };
      
      this.logger.debug('Sending request to BOE API', {
        endpoint: '/analyze-text',
        body_preview: JSON.stringify(requestBody).substring(0, 200),
        api_key_present: !!this.apiKey,
        api_url: this.apiUrl,
        client_configured: !!this.client
      });
      
      const response = await this.client.post('/analyze-text', requestBody);
      
      this.logger.debug('Received response from BOE API', {
        status: response.status,
        data_size: JSON.stringify(response.data).length,
        results_count: response.data?.results?.length || 0,
        response_success: !!response.data
      });
      
      // Ensure we return a standard format even if the response is unexpected
      if (!response.data) {
        return { entries: [], status: 'empty_response' };
      }
      
      // Transform the response format to match what the subscription processor expects
      if (response.data.results) {
        // Extract all matches from all results
        const entries = [];
        
        // Each result corresponds to one prompt
        response.data.results.forEach(result => {
          if (result.matches && Array.isArray(result.matches)) {
            // Add the prompt to each match for tracking
            const matchesWithPrompt = result.matches.map(match => ({
              ...match,
              prompt: result.prompt
            }));
            entries.push(...matchesWithPrompt);
          }
        });
        
        return { 
          entries,
          status: 'success',
          query_date: response.data.query_date,
          boe_info: response.data.boe_info
        };
      }
      
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
      
      return { 
        entries: [],
        status: 'error',
        error: error.message
      };
    }
  }
}

module.exports = BOEProcessor;