/**
 * Parsers Service
 * Handles communication with different parser services based on subscription type.
 */
const axios = require('axios');
const logger = require('../utils/logger');

// Parser configuration
const PARSERS = {
  'boe': {
    url: process.env.BOE_PARSER_URL || 'https://boe-parser-415554190254.us-central1.run.app',
    parseEndpoint: '/parse'
  },
  'doga': {
    url: process.env.DOGA_PARSER_URL || 'https://doga-parser-415554190254.us-central1.run.app',
    parseEndpoint: '/parse'
  }
  // Add other parsers as needed
};

/**
 * Send a subscription to the appropriate parser for processing
 * @param {Object} subscription - The subscription object
 * @returns {Promise<Object>} Result from the parser
 */
async function sendToParser(subscription) {
  const { id: subscriptionId, type_id: typeId, prompts, user_id: userId } = subscription;
  
  const parserConfig = PARSERS[typeId];
  
  if (!parserConfig) {
    logger.warn(`No parser configuration found for type: ${typeId}`);
    throw new Error(`Unsupported subscription type: ${typeId}`);
  }
  
  try {
    logger.info(`Sending subscription ${subscriptionId} to ${typeId} parser`);
    
    const formattedPrompts = Array.isArray(prompts) ? prompts : 
      (typeof prompts === 'string' ? JSON.parse(prompts) : prompts);
    
    const response = await axios.post(`${parserConfig.url}${parserConfig.parseEndpoint}`, {
      subscriptionId,
      userId,
      prompts: formattedPrompts
    });
    
    logger.info(`Parser ${typeId} successfully processed subscription ${subscriptionId}`, {
      status: response.status,
      dataReceived: !!response.data
    });
    
    return response.data;
  } catch (error) {
    logger.error(`Error sending subscription ${subscriptionId} to ${typeId} parser`, {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    
    throw new Error(`Parser error: ${error.message}`);
  }
}

module.exports = {
  sendToParser,
  PARSERS
}; 