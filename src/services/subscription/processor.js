/**
 * Subscription Processor Service
 * 
 * Handles the core subscription processing logic - communicating with parser services
 * and processing the results.
 */

const crypto = require('crypto');

class SubscriptionProcessor {
  /**
   * Create a new SubscriptionProcessor
   * @param {Object} options - Dependencies
   * @param {Object} options.parserClient - Client for interacting with the parser service
   */
  constructor({ parserClient }) {
    if (!parserClient) {
      throw new Error('Missing required parserClient for SubscriptionProcessor');
    }
    this.parserClient = parserClient;
  }

  /**
   * Process a subscription by fetching data from the parser 
   * @param {Object} subscription - The subscription data
   * @param {string} traceId - Trace ID for logging
   * @returns {Promise<Array>} Array of matches from the parser
   */
  async processSubscriptionData(subscription, traceId) {
    if (!subscription || !subscription.id) {
      throw new Error('Invalid subscription data provided');
    }

    // Default prompts if none available
    const DEFAULT_PROMPTS = ['Información general', 'Noticias importantes'];
    
    // 1. Validate subscription has a parser URL
    if (!subscription.parser_url) {
      console.info('Skipping subscription with no parser URL', { 
        subscription_id: subscription.id, 
        type_id: subscription.type_id,
        type_name: subscription.type_name || 'unknown',
        trace_id: traceId
      });
      
      return { status: 'skipped', matches: [] };
    }

    // 2. Validate and prepare prompts
    const prompts = this._validatePrompts(subscription.prompts || DEFAULT_PROMPTS);
    
    try {
      // 3. Configure the parser client with the correct URL from subscription_types
      await this.parserClient.updateBaseURL(subscription.parser_url);
      console.info('Using parser URL from subscription type', {
        subscription_id: subscription.id,
        parser_url: subscription.parser_url,
        type_name: subscription.type_name
      });
      
      // 4. Create a standardized request according to the parser protocol
      const requestData = {
        texts: prompts,
        metadata: {
          user_id: subscription.user_id,
          subscription_id: subscription.id,
          type_id: subscription.type_id,
          type_name: subscription.type_name,
          trace_id: traceId
        },
        date: new Date().toISOString().split('T')[0] // Use today's date in ISO format
      };

      console.debug('Sending request to parser for subscription type', { 
        subscription_id: subscription.id,
        type_id: subscription.type_id,
        parser_url: subscription.parser_url,
        type_name: subscription.type_name,
        prompts: prompts
      });
      
      // 5. Send the request to the parser service
      const parserResult = await this.parserClient.send(requestData);

      console.info('Parser processing completed', { 
        subscription_id: subscription.id,
        type_id: subscription.type_id,
        status: parserResult.status,
        entries_count: parserResult.entries?.length || 0 
      });

      // 6. Process Results into Matches
      const matches = this._processParserEntries(parserResult, prompts, traceId);
      
      return { status: 'success', matches };
    } catch (error) {
      console.error('Error processing with parser', { 
        subscription_id: subscription.id,
        error: error.message,
        trace_id: traceId
      });
      throw error;
    }
  }

  /**
   * Process parser entries into a standardized match format
   * @private
   */
  _processParserEntries(parserResult, originalPrompts, traceId) {
    if (!parserResult || parserResult.status === 'error' || !Array.isArray(parserResult.entries)) {
      console.warn('No valid parser results to process');
      return [];
    }
    
    const matches = parserResult.entries
      .filter(entry => entry && typeof entry === 'object')
      .map(entry => {
        const prompt = entry.prompt || (originalPrompts && originalPrompts[0]) || 'Información general';
        return {
          document_type: entry.document_type || 'generic',
          title: entry.title || 'Documento sin título',
          notification_title: entry.notification_title || this._generateNotificationTitle(entry),
          issuing_body: entry.issuing_body || entry.department || '',
          summary: entry.summary || entry.content || 'Sin contenido',
          relevance_score: entry.relevance_score || 0,
          prompt: prompt,
          links: entry.links || {},
          publication_date: entry.dates?.publication_date || new Date().toISOString().split('T')[0],
          department: entry.department || '',
          section: entry.section || ''
        };
      });
      
    console.debug('Processed parser results into matches', { 
      valid_matches: matches.length,
      trace_id: traceId
    });
    
    return matches;
  }
  
  /**
   * Validate and clean up prompts
   * @private
   */
  _validatePrompts(prompts) {
    // Handle different prompt formats
    let cleanPrompts = prompts;
    
    // If prompts is a string, try to parse it as JSON
    if (typeof prompts === 'string') {
      try {
        cleanPrompts = JSON.parse(prompts);
      } catch (err) {
        // If it's not valid JSON, use it as a single prompt
        cleanPrompts = [prompts];
      }
    }
    
    // Ensure prompts is always an array
    if (!Array.isArray(cleanPrompts)) {
      if (cleanPrompts) {
        cleanPrompts = [String(cleanPrompts)];
      } else {
        cleanPrompts = [];
      }
    }
    
    // Filter out empty prompts and trim whitespace
    cleanPrompts = cleanPrompts
      .filter(prompt => prompt && typeof prompt === 'string' && prompt.trim().length > 0)
      .map(prompt => prompt.trim());
    
    // Use default prompts if none are provided
    if (cleanPrompts.length === 0) {
      console.warn('No valid prompts found, using defaults');
      return ['Información general', 'Noticias importantes'];
    }
    
    return cleanPrompts;
  }
  
  /**
   * Generate a notification title from a document
   * @private
   */
  _generateNotificationTitle(document) {
    if (!document) return 'Nueva notificación';
    
    const title = document.title || '';
    if (title.length <= 60) return title;
    
    return title.substring(0, 57) + '...';
  }
}

module.exports = { SubscriptionProcessor }; 