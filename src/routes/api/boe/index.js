/**
 * BOE API Routes
 * Handles BOE-specific operations.
 */
const express = require('express');
const { getLogger } = require('../../../config/logger');
const { validateBOERequest } = require('../../../middleware/validation');

const logger = getLogger('boe-api');

/**
 * Create BOE router
 * @param {string} parserApiKey - API key for BOE parser
 * @returns {Object} Express router
 */
function createBOERouter(parserApiKey) {
  const router = express.Router();

  /**
   * POST /api/boe/process
   * Process a BOE subscription
   */
  router.post('/process', validateBOERequest, async (req, res) => {
    const { prompts, options, user_id, subscription_id } = req.body;
    
    logger.info('BOE process request received', {
      prompts_count: prompts.length,
      user_id: user_id || 'not provided',
      subscription_id: subscription_id || 'not provided',
      options: options || {}
    });
    
    try {
      // Initialize BOE processor
      const BOEProcessor = require('../../../services/processors/boe');
      const processor = new BOEProcessor({
        BOE_API_KEY: parserApiKey,
        BOE_API_URL: process.env.BOE_API_URL || 'https://boe-parser-415554190254.us-central1.run.app'
      });
      
      // Process the request
      const startTime = Date.now();
      
      const data = {
        subscription_id: subscription_id || `test-${Date.now()}`,
        user_id: user_id || 'api-user',
        prompts: prompts,
        metadata: {
          options: options || {}
        }
      };
      
      const result = await processor.processSubscription(data);
      
      const processingTime = Date.now() - startTime;
      
      // Add processing time to result
      result.processing_time_ms = processingTime;
      
      logger.info('BOE processing completed', {
        prompts_count: prompts.length,
        processing_time_ms: processingTime,
        entries_count: result.entries?.length || 0,
        matches_count: result.matches?.length || 0
      });
      
      res.status(200).json(result);
    } catch (error) {
      logger.error('Error processing BOE request', {
        error: error.message,
        stack: error.stack,
        prompts_count: prompts.length
      });
      
      res.status(500).json({
        status: 'error',
        error: 'BOE processing failed',
        message: error.message,
        request: {
          prompts_count: prompts.length,
          options: options || {}
        }
      });
    }
  });

  /**
   * GET /api/boe/supported-sections
   * Get supported BOE sections
   */
  router.get('/supported-sections', (req, res) => {
    const sections = [
      {
        id: 'BDNS',
        name: 'Base de Datos Nacional de Subvenciones',
        description: 'Subvenciones y ayudas públicas'
      },
      {
        id: 'BOE-S-SECCI',
        name: 'Sección I',
        description: 'Disposiciones generales'
      },
      {
        id: 'BOE-S-SECCII',
        name: 'Sección II',
        description: 'Autoridades y personal'
      },
      {
        id: 'BOE-S-SECCIII',
        name: 'Sección III',
        description: 'Otras disposiciones'
      },
      {
        id: 'BOE-S-SECCIV',
        name: 'Sección IV',
        description: 'Administración de Justicia'
      },
      {
        id: 'BOE-S-SECCV',
        name: 'Sección V',
        description: 'Anuncios'
      }
    ];
    
    res.status(200).json({
      status: 'success',
      sections
    });
  });

  /**
   * GET /api/boe/document/:id
   * Get a BOE document by ID
   */
  router.get('/document/:id', (req, res) => {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        status: 'error',
        error: 'Missing document ID',
        message: 'A document ID is required',
        usage: {
          path: '/api/boe/document/:id',
          example: '/api/boe/document/BOE-A-2023-12345'
        }
      });
    }
    
    // This is a placeholder - would normally connect to BOE API
    logger.info(`Request for BOE document ${id}`);
    
    res.status(404).json({
      status: 'error',
      error: 'Document not found',
      message: `The document ${id} was not found or is not available`,
      document_id: id
    });
  });

  return router;
}

module.exports = createBOERouter;