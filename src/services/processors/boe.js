const BaseProcessor = require('./base');
const { getLogger } = require('../../config/logger');
const { ParserClient } = require('../../utils/parser-protocol');

const BOE_PARSER_URL = 'https://boe-parser-415554190254.us-central1.run.app';

class BOEProcessor extends BaseProcessor {
  /**
   * Create a new BOE Processor instance
   * @param {Object} config Configuration options
   * @param {string} [config.BOE_API_URL] Base URL for the BOE parser service
   * @param {string} [config.BOE_API_KEY] API key for the BOE parser service
   */
  constructor(config) {
    super();
    this.config = config || {};
    this.logger = getLogger('boe-processor');
    
    // Get service configuration with fallback
    this.apiUrl = this.config.BOE_API_URL || process.env.BOE_API_URL || BOE_PARSER_URL;
    this.apiKey = this.config.BOE_API_KEY || process.env.BOE_API_KEY || '';
    
    this.logger.debug('BOE Processor initializing', { 
      api_url_masked: this.apiUrl.replace(/\/\/([^@]+@)?/, '//***@'),
      api_key_present: !!this.apiKey
    });
    
    // Create standardized parser client using the protocol
    this.parserClient = new ParserClient({
      baseURL: this.apiUrl,
      apiKey: this.apiKey,
      type: 'boe',
      logger: this.logger
    });
    
    this.logger.debug('BOE processor initialization complete');
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
   * Analyze BOE content based on provided prompts
   * @param {Array<string>} prompts - The search prompts
   * @param {string} subscriptionId - The subscription ID
   * @param {string} userId - The user ID
   * @returns {Promise<Object>} The analysis result
   */
  async analyzeContent(prompts, subscriptionId, userId) {
    this.logger.debug('Starting BOE content analysis', {
      prompt_count: Array.isArray(prompts) ? prompts.length : 0,
      subscription_id: subscriptionId || 'unknown'
    });
    
    try {
      // Create a standardized request using the protocol
      const requestBody = this.parserClient.createRequest(
        prompts,
        userId,
        subscriptionId
      );
      
      // Send the request using the standardized protocol
      const result = await this.parserClient.send(requestBody);
      
      this.logger.info('BOE analysis completed', {
        subscription_id: subscriptionId || 'unknown',
        entry_count: result.entries?.length || 0,
        status: result.status
      });
      
      return result;
      
    } catch (error) {
      this.logger.error('Error in BOE content analysis', {
        error: error.message,
        subscription_id: subscriptionId || 'unknown'
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