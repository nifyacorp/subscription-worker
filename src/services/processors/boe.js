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

    // Configuration for retry mechanism
    this.maxRetries = 3;
    this.initialRetryDelay = 1000; // 1 second initial delay
    this.maxRetryDelay = 20000; // Maximum 20 seconds between retries

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
    // Use ZOD validation to validate and sanitize the subscription
    const { validateSubscription, sanitizeSubscription } = require('../../utils/validation');
    
    // First sanitize the subscription
    const sanitizedSubscription = sanitizeSubscription(subscription);
    
    if (!sanitizedSubscription) {
      this.logger.error('Subscription is null or undefined');
      throw new Error('Cannot process null or undefined subscription');
    }
    
    // Validate the subscription
    const validationResult = validateSubscription(sanitizedSubscription);
    
    if (!validationResult.valid) {
      this.logger.warn('Subscription validation warnings', {
        errors: validationResult.errors,
        subscription_id: sanitizedSubscription.subscription_id || sanitizedSubscription.id || 'unknown'
      });
      // Continue with the sanitized data even if validation has warnings
    }
    
    // Use the validated/sanitized subscription
    const validSubscription = validationResult.data;
    
    // Extract user ID and subscription ID
    const subscription_id = validSubscription.subscription_id || validSubscription.id;
    const user_id = validSubscription.user_id;
    
    this.logger.debug('Processing BOE subscription', {
      subscription_id: subscription_id || 'unknown',
      user_id: user_id || 'unknown',
      subscription_type: typeof validSubscription,
      subscription_fields: Object.keys(validSubscription || {})
    });
    
    // Normalize prompts to ensure consistent format
    let prompts = [];

    if (validSubscription.prompts) {
      // Handle different formats of prompts
      if (Array.isArray(validSubscription.prompts)) {
        prompts = validSubscription.prompts.filter(p => typeof p === 'string' && p.trim());
      } else if (typeof validSubscription.prompts === 'string') {
        // Try to parse as JSON if it looks like an array
        if (validSubscription.prompts.trim().startsWith('[')) {
          try {
            const parsed = JSON.parse(validSubscription.prompts);
            if (Array.isArray(parsed)) {
              prompts = parsed.filter(p => typeof p === 'string' && p.trim());
            } else {
              prompts = [validSubscription.prompts];
            }
          } catch (e) {
            // Not valid JSON, treat as single prompt
            prompts = [validSubscription.prompts];
          }
        } else {
          // Single prompt string
          prompts = [validSubscription.prompts.trim()];
        }
      }
    }

    this.logger.debug('Normalized prompts for BOE processing', {
      subscription_id: validSubscription.subscription_id,
      original_prompts: validSubscription.prompts,
      normalized_prompts: prompts,
      normalized_count: prompts.length
    });
    
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
   * Analyze BOE content based on provided prompts with retry mechanism
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
    
    // Prepare the request body once outside the retry loop
    const requestBody = {
      texts: prompts, // Using 'texts' as the key as expected by the BOE parser
      metadata: {
        user_id: safeUserId,
        subscription_id: safeSubscriptionId,
      },
      limit: 5,
      date: new Date().toISOString().split('T')[0]
    };
    
    // Implementation of exponential backoff retry logic
    let retries = 0;
    let lastError = null;
    let timeoutFactor = 1.0; // Start with normal timeout
    
    while (retries <= this.maxRetries) {
      try {
        // Adjust timeout for retries to give more time
        const currentTimeout = Math.min(
          this.client.defaults.timeout * timeoutFactor, 
          240000 // Max 4 minutes
        );
        
        this.logger.debug('Sending request to BOE API (attempt ' + (retries + 1) + ')', {
          endpoint: '/analyze-text',
          timeout_ms: currentTimeout,
          body_preview: JSON.stringify(requestBody).substring(0, 200),
          api_key_present: !!this.apiKey,
          api_url: this.apiUrl,
          retry_count: retries
        });
        
        // Clone the default axios config and adjust timeout for this request
        const requestConfig = {
          timeout: currentTimeout
        };
        
        // Send the request with adjusted timeout
        const response = await this.client.post('/analyze-text', requestBody, requestConfig);
        
        this.logger.debug('Received response from BOE API', {
          status: response.status,
          data_size: JSON.stringify(response.data).length,
          results_count: response.data?.results?.length || 0,
          response_success: !!response.data,
          data_preview: JSON.stringify(response.data).substring(0, 200) + '...',
          attempt: retries + 1
        });
        
        // Ensure we return a standard format even if the response is unexpected
        if (!response.data) {
          this.logger.warn('Empty response from BOE API', {
            subscription_id: safeSubscriptionId,
            status_code: response.status
          });
          return { entries: [], status: 'empty_response' };
        }
        
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
        lastError = error;
        retries++;
        
        // Determine if this error is retryable
        const isTimeout = error.code === 'ECONNABORTED' || 
                          error.message.includes('timeout') ||
                          error.response?.status === 504; // Gateway Timeout
                          
        const isServerError = error.response?.status >= 500 && error.response?.status < 600;
        const isRetryable = isTimeout || isServerError;
        
        if (!isRetryable || retries > this.maxRetries) {
          // Non-retryable error or max retries reached
          this.logger.error('Error analyzing BOE content (non-retryable or max retries reached)', {
            error: error.message,
            status: error.response?.status,
            data: error.response?.data ? JSON.stringify(error.response.data).substring(0, 200) : 'No response data',
            request: {
              url: error.config?.url,
              method: error.config?.method,
              data: error.config?.data ? JSON.stringify(error.config.data).substring(0, 200) : 'No request data'
            },
            retry_count: retries,
            is_retryable: isRetryable
          });
          break;
        }
        
        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.initialRetryDelay * Math.pow(2, retries - 1) + Math.random() * 1000,
          this.maxRetryDelay
        );
        
        // Increase timeout for next attempt
        timeoutFactor = 1.5 * Math.pow(1.5, retries - 1); // 1.5x, 2.25x, 3.375x original timeout
        
        this.logger.warn(`Retryable error, attempt ${retries}/${this.maxRetries}. Retrying in ${Math.round(delay)}ms`, {
          error: error.message,
          error_code: error.code,
          status: error.response?.status,
          subscription_id: safeSubscriptionId,
          next_timeout_factor: timeoutFactor
        });
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // If we get here, all retries failed
    this.logger.error('All retry attempts failed for BOE analysis', {
      error: lastError?.message,
      status: lastError?.response?.status,
      retry_count: retries,
      subscription_id: safeSubscriptionId
    });
    
    return { 
      entries: [],
      status: 'error',
      error: lastError?.message || 'Max retry attempts reached',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = BOEProcessor;