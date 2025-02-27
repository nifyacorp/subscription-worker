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
        ...(config.BOE_API_KEY && { 'Authorization': `Bearer ${config.BOE_API_KEY}` })
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
    
    // More detailed logging about where we're looking for prompts
    this.logger.debug('Searching for prompts in subscription data', {
      subscription_id: subscription_id || 'unknown',
      has_prompts_direct: Array.isArray(subscription.prompts),
      has_prompts_metadata: subscription.metadata && Array.isArray(subscription.metadata.prompts),
      has_text_direct: Array.isArray(subscription.texts),
      has_text_metadata: subscription.metadata && Array.isArray(subscription.metadata.texts),
      metadata_keys: subscription.metadata ? Object.keys(subscription.metadata) : []
    });

    // Add VERY detailed logging about the subscription object
    this.logger.debug('Complete subscription object contents', {
      subscription_id: subscription_id || 'unknown',
      subscription_type: typeof subscription,
      subscription_properties: Object.getOwnPropertyNames(subscription),
      prompts_field: subscription.prompts,
      prompts_field_type: typeof subscription.prompts,
      is_prompts_array: Array.isArray(subscription.prompts),
      subscription_json: JSON.stringify(subscription).substring(0, 500) + '...',
      constructor_name: subscription.constructor ? subscription.constructor.name : 'unknown'
    });
    
    // Check for prompts in various locations
    if (Array.isArray(subscription.prompts) && subscription.prompts.length > 0) {
      this.logger.debug('Found prompts directly in subscription.prompts', {
        prompts: subscription.prompts
      });
      prompts = subscription.prompts;
    } else if (typeof subscription.prompts === 'string') {
      // Handle case where prompts might be a string representation of an array
      try {
        const parsedPrompts = JSON.parse(subscription.prompts);
        if (Array.isArray(parsedPrompts) && parsedPrompts.length > 0) {
          this.logger.debug('Found prompts in string format, parsed to array', {
            prompts: parsedPrompts
          });
          prompts = parsedPrompts;
        } else {
          // If it's a string but not an array, use it as a single prompt
          this.logger.debug('Found prompts as a single string', {
            prompt: subscription.prompts
          });
          prompts = [subscription.prompts];
        }
      } catch (error) {
        // If it's not valid JSON, use it as a single prompt
        this.logger.debug('Found prompts as non-JSON string, using as single prompt', {
          prompt: subscription.prompts
        });
        prompts = [subscription.prompts];
      }
    } else if (subscription.metadata && Array.isArray(subscription.metadata.prompts) && subscription.metadata.prompts.length > 0) {
      this.logger.debug('Found prompts in subscription.metadata.prompts', {
        prompts: subscription.metadata.prompts
      });
      prompts = subscription.metadata.prompts;
    } else if (Array.isArray(subscription.texts) && subscription.texts.length > 0) {
      this.logger.debug('Found prompts in subscription.texts', {
        prompts: subscription.texts
      });
      prompts = subscription.texts;
    } else if (subscription.metadata && Array.isArray(subscription.metadata.texts) && subscription.metadata.texts.length > 0) {
      this.logger.debug('Found prompts in subscription.metadata.texts', {
        prompts: subscription.metadata.texts
      });
      prompts = subscription.metadata.texts;
    } else {
      this.logger.warn('No prompts found in subscription data, using default', {
        subscription_id: subscription_id || 'unknown'
      });
      prompts = ['Información general del BOE'];
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
    
    // Filter out any non-string prompts and ensure they're non-empty
    prompts = prompts
      .filter(prompt => typeof prompt === 'string' && prompt.trim().length > 0)
      .map(prompt => prompt.trim());
      
    // If after filtering we have no valid prompts, use a default
    if (prompts.length === 0) {
      this.logger.warn('No valid prompts after filtering, using default');
      prompts = ['Información general del BOE'];
    }
    
    // Ensure we have valid IDs, using defaults if needed
    const safeSubscriptionId = subscriptionId || 'system-subscription-' + Date.now();
    const safeUserId = userId || 'system-user-' + Date.now();
    
    this.logger.debug('Analyzing BOE content', { 
      prompts,
      subscription_id: safeSubscriptionId,
      user_id: safeUserId 
    });
    
    try {
      const requestBody = {
        texts: prompts, // Using 'texts' as the key as expected by the BOE parser
        metadata: {
          user_id: safeUserId,
          subscription_id: safeSubscriptionId,
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
        response_success: !!response.data,
        data_preview: JSON.stringify(response.data).substring(0, 200) + '...'
      });
      
      // Ensure we return a standard format even if the response is unexpected
      if (!response.data) {
        this.logger.warn('Empty response from BOE API', {
          subscription_id: safeSubscriptionId,
          status_code: response.status
        });
        return { entries: [], status: 'empty_response' };
      }
      
      // IMPORTANT: We're no longer publishing to PubSub here
      // That responsibility has been moved to the Subscription Worker
      
      // Transform the response format to match what the subscription processor expects
      if (response.data.results) {
        // Extract all matches from all results
        const entries = [];
        
        // Each result corresponds to one prompt
        response.data.results.forEach((result, index) => {
          const currentPrompt = prompts[index] || 'unknown';
          
          if (result.matches && Array.isArray(result.matches)) {
            // Add the prompt to each match for tracking
            const matchesWithPrompt = result.matches.map(match => ({
              ...match,
              prompt: currentPrompt
            }));
            entries.push(...matchesWithPrompt);
            
            this.logger.debug('Processed matches for prompt', {
              prompt: currentPrompt,
              matches_count: result.matches.length
            });
          } else {
            this.logger.warn('No matches for prompt', {
              prompt: currentPrompt,
              result_keys: Object.keys(result)
            });
          }
        });
        
        if (entries.length === 0) {
          this.logger.info('No matches found in any results', {
            subscription_id: safeSubscriptionId,
            prompt_count: prompts.length
          });
        }
        
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
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = BOEProcessor;