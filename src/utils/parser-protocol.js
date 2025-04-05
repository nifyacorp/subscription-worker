/**
 * Parser Communication Protocol
 * 
 * A standardized protocol for communication between subscription-worker and parser services.
 * This module ensures consistent API requests, error handling, and response processing.
 */

const axios = require('axios');
const { z } = require('zod');
const http = require('http');
const https = require('https');

// Constants
const DEFAULT_TIMEOUT = 120000; // 2 minutes
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 20000; // 20 seconds

// Configure schema to validate parser request
const ParserRequestSchema = z.object({
  texts: z.array(z.string()).min(1),
  metadata: z.object({
    user_id: z.string(),
    subscription_id: z.string()
  }),
  limit: z.number().optional().default(5),
  date: z.string().optional()
});

// Configure schema to validate parser response
const ParserResponseSchema = z.object({
  query_date: z.string(),
  results: z.array(z.object({
    prompt: z.string().optional(),
    matches: z.array(z.object({
      document_type: z.string(),
      title: z.string(),
      issuing_body: z.string().optional(),
      summary: z.string().optional(),
      relevance_score: z.number(),
      links: z.object({
        html: z.string().url(),
        pdf: z.string().url().optional()
      }).optional()
    }).passthrough())
  })),
  metadata: z.object({
    total_items_processed: z.number().optional(),
    processing_time_ms: z.number().optional()
  }).optional()
}).passthrough();

/**
 * Creates a standardized HTTP/HTTPS agent to handle socket connection issues
 * @param {boolean} isHttps - Whether to create an HTTPS agent
 * @returns {http.Agent|https.Agent} Configured agent
 */
function createKeepAliveAgent(isHttps = true) {
  const options = {
    keepAlive: true,
    keepAliveMsecs: 10000, // 10 seconds - reduced from 30 seconds
    maxSockets: 50, // Reduced from 100
    maxFreeSockets: 5, // Reduced from 10
    timeout: 120000 // 120 seconds socket timeout - match with DEFAULT_TIMEOUT
  };
  
  return isHttps ? new https.Agent(options) : new http.Agent(options);
}

/**
 * ParserClient - A standardized client for communicating with parser services
 */
class ParserClient {
  /**
   * Create a new ParserClient instance
   * @param {Object} config Configuration options
   * @param {string} config.baseURL - Base URL for the parser service
   * @param {string} [config.apiKey] - API key for authentication
   * @param {string} [config.type] - Parser type (e.g., 'boe', 'doga')
   */
  constructor(config) {
    if (!config || !config.baseURL) {
      throw new Error('ParserClient requires a baseURL');
    }

    this.config = config;
    this.baseURL = config.baseURL;
    this.apiKey = config.apiKey || '';
    this.type = config.type || 'generic';
    
    // Create agents for keep-alive connections
    const isHttps = this.baseURL.startsWith('https://');
    this.httpAgent = createKeepAliveAgent(!isHttps);
    this.httpsAgent = createKeepAliveAgent(isHttps);
    
    // Create axios client with standardized configuration
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: DEFAULT_TIMEOUT,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Connection': 'keep-alive',
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
      },
      maxContentLength: 50 * 1024 * 1024, // 50MB
      maxRedirects: 5
    });
    
    this._initializeClient(config);
  }
  
  _initializeClient(config) {
    // Configure interceptors for logging
    this.client.interceptors.request.use((reqConfig) => {
      console.debug('ParserClient: Outgoing request', { method: reqConfig.method, url: reqConfig.url });
      return reqConfig;
    });
    
    this.client.interceptors.response.use(
      (response) => {
        console.debug('ParserClient: Response received', { status: response.status });
        return response;
      },
      (error) => {
        console.error('ParserClient: Request failed', { 
          message: error.message, 
          code: error.code, 
          status: error.response?.status, 
          url: error.config?.url 
        });
        throw error;
      }
    );

    console.debug('Parser client initialized', { type: this.type, baseURL: this.baseURL });
  }
  
  /**
   * Create a standardized request to the parser
   * @param {Array<string>} prompts - Text prompts to analyze
   * @param {string} userId - User ID
   * @param {string} subscriptionId - Subscription ID
   * @param {Object} [options] - Additional options
   * @returns {Object} Standardized request body
   */
  createRequest(prompts, userId, subscriptionId, options = {}) {
    // Ensure prompts are valid
    const normalizedPrompts = Array.isArray(prompts) 
      ? prompts.filter(p => typeof p === 'string' && p.trim()).map(p => p.trim())
      : ['Información general'];
      
    if (normalizedPrompts.length === 0) {
      normalizedPrompts.push('Información general');
    }
    
    // Ensure we have valid IDs
    const safeUserId = userId || 'system-user-' + Date.now();
    const safeSubscriptionId = subscriptionId || 'system-subscription-' + Date.now();
    
    // Create standard request object
    const request = {
      texts: normalizedPrompts,
      metadata: {
        user_id: safeUserId,
        subscription_id: safeSubscriptionId
      },
      limit: options.limit || 5,
      date: options.date || new Date().toISOString().split('T')[0]
    };
    
    // Validate the request against our schema
    try {
      return ParserRequestSchema.parse(request);
    } catch (error) {
      console.error('Invalid parser request', {
        error: error.message,
        issues: error.issues,
        request
      });
      throw new Error(`Invalid parser request: ${error.message}`);
    }
  }
  
  /**
   * Send a request to the parser service with retry logic
   * @param {Object} requestBody - The request body created by createRequest
   * @param {Object} [options] - Options for the request
   * @returns {Promise<Object>} Normalized response
   */
  async send(requestBody, options = {}) {
    const endpoint = options.endpoint || '/analyze-text';
    let retries = 0;
    let lastError = null;
    let timeoutFactor = 1.0;
    
    // Extract the subscription ID for logging
    const subscriptionId = requestBody.metadata?.subscription_id || 'unknown';
    
    console.info('Sending request to parser', { endpoint, type: this.type });
    
    while (retries <= MAX_RETRIES) {
      try {
        // Adjust timeout for retries
        const currentTimeout = Math.min(
          DEFAULT_TIMEOUT * timeoutFactor,
          240000 // Max 4 minutes
        );
        
        if (retries > 0) {
          console.debug(`Retry attempt ${retries}/${MAX_RETRIES}`, {
            subscription_id: subscriptionId,
            timeout_ms: currentTimeout
          });
        }
        
        // Send the request
        const response = await this.client.post(endpoint, requestBody, {
          timeout: currentTimeout,
          validateStatus: status => status >= 200 && status < 300
        });
        
        // Validate the response
        try {
          const validatedResponse = ParserResponseSchema.parse(response.data);
          return this._normalizeResponse(validatedResponse, requestBody.texts);
        } catch (validationError) {
          console.warn('Invalid parser response format', {
            subscription_id: subscriptionId,
            error: validationError.message,
            issues: validationError.issues
          });
          
          // Return a best-effort response even if validation fails
          return this._normalizeResponse(response.data, requestBody.texts);
        }
        
      } catch (error) {
        lastError = error;
        retries++;
        
        // Classify the error to determine if it's retryable
        const isNetworkError = !error.response && (
          error.code === 'ECONNABORTED' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'EHOSTUNREACH' ||
          error.message.includes('timeout') ||
          error.message.includes('socket hang up')
        );
        
        const isServerError = error.response?.status >= 500;
        const isTooManyRequests = error.response?.status === 429;
        const isRetryable = isNetworkError || isServerError || isTooManyRequests;
        
        // If not retryable or max retries reached, break the loop
        if (!isRetryable || retries > MAX_RETRIES) {
          console.error('ParserClient: Non-retryable error or max retries reached', { 
            error: error.message, 
            status: error.response?.status, 
            retries 
          });
          break;
        }
        
        // Calculate delay with exponential backoff and jitter
        const delay = Math.min(
          INITIAL_RETRY_DELAY * Math.pow(2, retries - 1) + Math.random() * 1000,
          MAX_RETRY_DELAY
        );
        
        // Increase timeout for next attempt
        timeoutFactor = 1.5 * Math.pow(1.5, retries - 1);
        
        console.warn(`ParserClient: Retryable error, waiting ${Math.round(delay)}ms before retry`, { 
            error: error.message, 
            status: error.response?.status, 
            attempt: retries 
        });
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // All retries failed
    console.error('ParserClient: All retry attempts failed', { error: lastError?.message });
    
    return {
      entries: [],
      status: 'error',
      error: lastError?.message || 'Unknown error',
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Normalize the parser response to a standard format
   * @private
   * @param {Object} response - Parser service response
   * @param {Array<string>} prompts - Original prompts sent to the parser
   * @returns {Object} Normalized response
   */
  _normalizeResponse(response, prompts) {
    // If no results, return empty response
    if (!response || !response.results || !Array.isArray(response.results)) {
      return {
        entries: [],
        status: 'success',
        timestamp: new Date().toISOString()
      };
    }
    
    // Extract matches from all results
    const entries = [];
    
    response.results.forEach((result, index) => {
      const currentPrompt = prompts[index] || 'unknown';
      
      if (result.matches && Array.isArray(result.matches)) {
        // Add the prompt to each match
        const matchesWithPrompt = result.matches.map(match => ({
          ...match,
          prompt: currentPrompt
        }));
        
        entries.push(...matchesWithPrompt);
      }
    });
    
    // Return standardized response
    return {
      entries,
      status: 'success',
      query_date: response.query_date,
      source_info: response.boe_info || response.doga_info || {},
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Close any persistent connections
   */
  close() {
    if (this.httpAgent) {
      this.httpAgent.destroy();
    }
    
    if (this.httpsAgent) {
      this.httpsAgent.destroy();
    }
    
    // Cancel any pending requests
    if (this.client) {
      // Create a new CancelToken to cancel any pending requests
      const CancelToken = axios.CancelToken;
      this.client.defaults.cancelToken = new CancelToken(cancel => {
        cancel('Operation cancelled due to client close');
      });
    }
    
    console.debug('Parser client connections closed');
  }
}

module.exports = {
  ParserClient,
  ParserRequestSchema,
  ParserResponseSchema,
  DEFAULT_TIMEOUT,
  MAX_RETRIES,
  INITIAL_RETRY_DELAY,
  MAX_RETRY_DELAY
};