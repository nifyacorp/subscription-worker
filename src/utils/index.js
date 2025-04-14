/**
 * Utils module 
 * Centralized exports for utility functions
 */

// Re-export organized utilities
const validation = require('./validation');
const process = require('./process');
const parser = require('./parser');

module.exports = {
  // Validation utilities
  validation,
  
  // Process utilities
  process,
  
  // Parser utilities
  parser,
  
  // Direct access to common utilities (for backward compatibility)
  validateSubscription: validation.validateSubscription,
  sanitizeSubscription: validation.sanitizeSubscription,
  validateProcessorResult: validation.validateProcessorResult,
  validateProcessingRequest: validation.validateProcessingRequest,
  validatePubSubNotification: validation.validatePubSubNotification,
  setupGracefulShutdown: process.setupGracefulShutdown,
  ParserClient: parser.ParserClient
}; 