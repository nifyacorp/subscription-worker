const { ParserClient: CoreParserClient } = require('../utils/parser-protocol');
const { getSecret } = require('../config/secrets');

// Constants for parser configuration
const DEFAULT_PARSER_BASE_URL = 'https://boe-parser-415554190254.us-central1.run.app';
const PARSER_API_KEY_SECRET_NAME = 'PARSER_API_KEY';

/**
 * ParserClient wrapper that handles automatic initialization and API key retrieval
 * Delegates most functionality to the core implementation in parser-protocol.js
 */
class ParserClient {
    constructor(config = {}) {
        this.parserBaseUrl = config.parserBaseUrl || process.env.PARSER_BASE_URL || DEFAULT_PARSER_BASE_URL;
        this.parserApiKey = config.parserApiKey;
        this.isInitialized = false;
        this.clientType = config.clientType || 'boe';
        this.client = null;
    }

    /**
     * Updates the base URL of the parser client.
     * @param {string} newBaseUrl - The new base URL to use
     */
    async updateBaseURL(newBaseUrl) {
        if (!newBaseUrl || newBaseUrl === this.parserBaseUrl) {
            return;
        }

        console.info('Updating parser base URL', { 
            previous_url: this.parserBaseUrl,
            new_url: newBaseUrl
        });
        
        this.parserBaseUrl = newBaseUrl;
        
        // Determine client type based on URL
        if (newBaseUrl.includes('boe')) {
            this.clientType = 'boe';
        } else if (newBaseUrl.includes('doga')) {
            this.clientType = 'doga';
        } else {
            this.clientType = 'generic';
        }
        
        if (this.client) {
            // Use the core client's updateBaseURL method directly
            await this.client.updateBaseURL(newBaseUrl);
            console.info('Updated parser client base URL', { new_url: newBaseUrl, client_type: this.clientType });
        } else if (this.isInitialized) {
            // If client doesn't exist but we're marked as initialized, re-initialize
            this.isInitialized = false;
            await this.initialize();
        }
    }

    /**
     * Initializes the parser client, fetching API key if necessary.
     */
    async initialize() {
        if (this.isInitialized && this.client) {
            return;
        }

        // Fetch API key only if not provided during construction
        if (!this.parserApiKey) {
            try {
                this.parserApiKey = await getSecret(PARSER_API_KEY_SECRET_NAME);
                console.info('Parser API key retrieved successfully.');
            } catch (error) {
                console.warn(`Failed to retrieve parser API key (${PARSER_API_KEY_SECRET_NAME})`, { error: error.message });
                this.parserApiKey = null;
            }
        }

        try {
            // Initialize the core client with our configuration
            this.client = new CoreParserClient({
                baseURL: this.parserBaseUrl,
                apiKey: this.parserApiKey,
                type: this.clientType
            });
            
            // Use the core client's initialize method
            await this.client.initialize(this.parserApiKey);
            
            console.info('Parser client configured successfully', { 
                base_url: this.parserBaseUrl,
                client_type: this.clientType,
                api_key_present: !!this.parserApiKey 
            });
            this.isInitialized = true;
        } catch (error) {
            console.error('Failed to initialize parser client', { error: error.message });
            throw error;
        }
    }

    /**
     * Delegate all parser client methods to the core implementation
     */

    /**
     * Creates a request payload for the parser.
     */
    async createRequest(prompts, userId, subscriptionId, options) {
        await this._ensureInitialized();
        return this.client.createRequest(prompts, userId, subscriptionId, options);
    }

    /**
     * Sends a request to the parser service.
     */
    async send(requestData) {
        await this._ensureInitialized();
        return this.client.send(requestData);
    }

    /**
     * Ensure client is initialized before use
     * @private
     */
    async _ensureInitialized() {
        if (!this.isInitialized || !this.client) {
            await this.initialize();
        }
    }

    /**
     * Close the client connection
     */
    close() {
        if (this.client) {
            this.client.close();
            this.client = null;
            this.isInitialized = false;
        }
    }
}

module.exports = ParserClient; 