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
        this.boeClient = null;
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
        
        // If already initialized, re-initialize with new URL
        if (this.isInitialized) {
            this.isInitialized = false; // Mark as uninitialized
            await this.initialize(); // Re-initialize with new URL
        }
    }

    /**
     * Initializes the underlying BOE parser client, fetching API key if necessary.
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
            this.boeClient = new BoeParserClient({
                baseURL: this.parserBaseUrl,
                apiKey: this.parserApiKey,
                type: 'boe' // Type is set to boe for now, this is for the client's internal type identification
            });

            console.info('Parser client configured', { 
                base_url: this.parserBaseUrl, 
                api_key_present: !!this.parserApiKey 
            });
            this.isInitialized = true;
        } catch (error) {
            console.error('Failed to initialize Parser client', { error: error.message });
            throw error; // Re-throw initialization error
        }
    }

    /**
     * Creates a request payload for the parser.
     * Delegates to the underlying BOE client.
     * @param {Array<string>} prompts
     * @param {string} userId
     * @param {string} subscriptionId
     * @param {Object} options - Additional options (limit, date)
     * @returns {Object} The request payload.
     */
    createRequest(prompts, userId, subscriptionId, options) {
        if (!this.isInitialized || !this.boeClient) {
            console.error('ParserClient not initialized. Call initialize() first.');
            throw new Error('ParserClient not initialized.');
        }
        return this.boeClient.createRequest(prompts, userId, subscriptionId, options);
    }

    /**
     * Sends a request to the parser service.
     * Delegates to the underlying BOE client.
     * @param {Object} requestData - The request payload created by createRequest.
     * @returns {Promise<Object>} The parser result.
     */
    async send(requestData) {
        if (!this.isInitialized || !this.boeClient) {
            console.error('ParserClient not initialized. Call initialize() first.');
            throw new Error('ParserClient not initialized.');
        }

        console.debug('Sending request to BOE parser', { 
            // Avoid logging full request data unless necessary for debugging
            subscription_id: requestData?.metadata?.subscription_id || 'unknown'
        }); 

        try {
            const result = await this.boeClient.send(requestData);
            console.info('Received response from BOE parser', { 
                status: result?.status,
                entries_count: result?.entries?.length || 0,
                subscription_id: requestData?.metadata?.subscription_id || 'unknown'
            });
            return result;
        } catch (error) {
             console.error('Error communicating with BOE parser', { 
                error: error.message,
                status: error.response?.status, // Include HTTP status if available
                subscription_id: requestData?.metadata?.subscription_id || 'unknown'
            });
            throw error; // Re-throw for the service layer
        }
    }
}

module.exports = ParserClient; 