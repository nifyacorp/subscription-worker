const axios = require('axios');
const { Pool } = require('pg');
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

class BOEController {
  constructor(apiKey, baseURL = process.env.PARSER_BASE_URL) {
    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async getPendingSubscriptions(pool) {
    try {
      const result = await pool.query(`
        SELECT * FROM subscription_processing
        WHERE status = 'pending'
        AND metadata->>'type' = 'boe'
        AND metadata->>'id' = 'boe-general'
        AND next_run_at <= NOW()
        LIMIT 5
      `);

      // Log the first subscription if available
      if (result.rows.length > 0) {
        const firstSub = result.rows[0];
        logger.debug({
          subscription_id: firstSub.subscription_id,
          last_run_at: firstSub.last_run_at,
          next_run_at: firstSub.next_run_at,
          status: firstSub.status,
          error: firstSub.error,
          metadata: firstSub.metadata
        }, 'First pending BOE subscription details');
      }

      return result.rows;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch pending BOE subscriptions');
      throw error;
    }
  }

  async analyzeTexts(queries) {
    try {
      logger.debug({ queries }, 'Sending queries to BOE parser');
      const response = await this.client.post('/analyze-text', {
        texts: queries
      });
      logger.debug({ 
        status: response.status,
        data_length: response.data?.results?.length
      }, 'Received BOE parser response');
      return response.data;
    } catch (error) {
      logger.error({ error }, 'BOE Analysis failed');
      throw error;
    }
  }

  async processSubscription(subscription) {
    try {
      logger.debug({ 
        subscription_id: subscription.subscription_id 
      }, 'Processing BOE subscription');

      // Extract prompts from metadata or use default prompts
      const prompts = subscription.metadata?.prompts || [
        'disposición',
        'ley',
        'real decreto'
      ];

      // Analyze BOE content
      const results = await this.analyzeTexts(prompts);

      logger.debug({ 
        subscription_id: subscription.subscription_id,
        results_count: results?.results?.length
      }, 'BOE analysis completed');

      return results;
    } catch (error) {
      logger.error({ 
        error,
        subscription_id: subscription.subscription_id
      }, 'Failed to process BOE subscription');
      throw error;
    }
  }
}

module.exports = BOEController;