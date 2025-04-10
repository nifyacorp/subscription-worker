const { ParserClient: BoeParserClient } = require('../utils/parser-protocol'); // Renamed to avoid name clash if needed
const { getSecret } = require('../config/secrets'); // Assuming secrets config is initialized elsewhere

// Constants or configuration values
const DEFAULT_PARSER_BASE_URL = 'https://boe-parser-415554190254.us-central1.run.app';
const PARSER_API_KEY_SECRET_NAME = 'PARSER_API_KEY';

class ParserClient {
    constructor(config) {
        this.parserBaseUrl = config.parserBaseUrl || process.env.PARSER_BASE_URL || DEFAULT_PARSER_BASE_URL;
        this.parserApiKey = config.parserApiKey;
        this.isInitialized = false;
        this.clientType = 'boe'; // Default client type
        this.client = null;
    }

    /**
     * Updates the base URL of the parser client.
     * If the client is already initialized, it will be re-initialized with the new URL.
     * @param {string} newBaseUrl - The new base URL to use
     */
    async updateBaseURL(newBaseUrl) {
        // If no URL is provided or it's the same as current, do nothing
        if (!newBaseUrl || newBaseUrl === this.parserBaseUrl) {
            return;
        }

        console.info('Updating parser base URL', { 
            previous_url: this.parserBaseUrl,
            new_url: newBaseUrl
        });
        
        this.parserBaseUrl = newBaseUrl;
        
        // Determine client type based on URL (this is a simple heuristic)
        if (newBaseUrl.includes('boe')) {
            this.clientType = 'boe';
        } else if (newBaseUrl.includes('doga')) {
            this.clientType = 'doga';
        } else {
            // Default to generic type, all parsers use the same protocol
            this.clientType = 'generic';
        }
        
        console.debug('Updated parser client type based on URL', {
            url: newBaseUrl,
            client_type: this.clientType
        });
        
        // If already initialized, re-initialize with new URL
        if (this.isInitialized) {
            this.isInitialized = false; // Mark as uninitialized
            await this.initialize(); // Re-initialize with new URL
        }
    }

    /**
     * Initializes the parser client, fetching API key if necessary.
     * Should be called before making requests.
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        // Fetch API key only if not provided during construction
        if (!this.parserApiKey) {
            try {
                this.parserApiKey = await getSecret(PARSER_API_KEY_SECRET_NAME);
                console.info('Parser API key retrieved successfully.');
            } catch (error) {
                console.warn(`Failed to retrieve parser API key (${PARSER_API_KEY_SECRET_NAME}). Parser requests might fail if key is required.`, { error: error.message });
                this.parserApiKey = null; // Ensure it's null if fetch failed
            }
        }

        try {
            // Initialize the client with the current configuration
            console.info('Initializing parser client', {
                base_url: this.parserBaseUrl,
                client_type: this.clientType,
                api_key_present: !!this.parserApiKey
            });
            
            // All parser types use the same client protocol
            this.client = new BoeParserClient({
                baseURL: this.parserBaseUrl,
                apiKey: this.parserApiKey,
                type: this.clientType
            });

            console.info('Parser client configured successfully', { 
                base_url: this.parserBaseUrl,
                client_type: this.clientType,
                api_key_present: !!this.parserApiKey 
            });
            this.isInitialized = true;
        } catch (error) {
            console.error('Failed to initialize parser client', { 
                error: error.message,
                client_type: this.clientType
            });
            throw error; // Re-throw initialization error
        }
    }

    /**
     * Creates a request payload for the parser.
     * Uses the protocol established by the BOE parser client, which all parsers follow.
     * @param {Array<string>} prompts
     * @param {string} userId
     * @param {string} subscriptionId
     * @param {Object} options - Additional options (limit, date)
     * @returns {Object} The request payload.
     */
    createRequest(prompts, userId, subscriptionId, options) {
        if (!this.isInitialized || !this.client) {
            console.error('ParserClient not initialized. Call initialize() first.');
            throw new Error('ParserClient not initialized.');
        }
        return this.client.createRequest(prompts, userId, subscriptionId, options);
    }

    /**
     * Sends a request to the parser service.
     * @param {Object} requestData - The request payload created by createRequest.
     * @returns {Promise<Object>} The parser result.
     */
    async send(requestData) {
        if (!this.isInitialized || !this.client) {
            console.error('ParserClient not initialized. Call initialize() first.');
            throw new Error('ParserClient not initialized.');
        }

        console.debug('Sending request to parser', { 
            client_type: this.clientType,
            subscription_id: requestData?.metadata?.subscription_id || 'unknown',
            subscription_type: requestData?.metadata?.type_name || 'unknown'
        }); 

        try {
            const result = await this.client.send(requestData);
            console.info('Received response from parser', { 
                client_type: this.clientType,
                status: result?.status,
                entries_count: result?.entries?.length || 0,
                subscription_id: requestData?.metadata?.subscription_id || 'unknown',
                subscription_type: requestData?.metadata?.type_name || 'unknown'
            });
            return result;
        } catch (error) {
             console.error('Error communicating with parser', { 
                client_type: this.clientType,
                error: error.message,
                status: error.response?.status, // Include HTTP status if available
                subscription_id: requestData?.metadata?.subscription_id || 'unknown',
                subscription_type: requestData?.metadata?.type_name || 'unknown'
            });
            throw error; // Re-throw for the service layer
        }
    }
}

module.exports = ParserClient; 