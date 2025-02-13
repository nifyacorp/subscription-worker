const express = require('express');
const { getLogger } = require('../config/logger');
const BOEProcessor = require('../services/processors/boe');

const logger = getLogger('boe-route');
const router = express.Router();

function createBOERouter(parserApiKey) {
  const boeProcessor = new BOEProcessor(parserApiKey);

  // Debug endpoint for testing BOE analysis
  router.post('/debug/analyze-boe', async (req, res) => {
    try {
      const { prompts } = req.body;

      if (!Array.isArray(prompts) || prompts.length === 0) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'Body must include "prompts" array with at least one prompt'
        });
      }

      logger.debug({ 
        prompts_count: prompts.length,
        first_prompt: prompts[0]
      }, 'Processing BOE analysis request');

      const result = await boeProcessor.analyzeContent(prompts);

      res.status(200).json({
        status: 'success',
        data: result
      });

    } catch (error) {
      logger.error({ error }, 'BOE analysis request failed');
      res.status(500).json({
        error: 'Analysis failed',
        details: error.message
      });
    }
  });

  return router;
}

module.exports = createBOERouter;