const express = require('express');
const { getLogger } = require('../config/logger');
const logger = getLogger('debug-controller');

function createDebugRouter(subscriptionProcessor, pool) {
  const router = express.Router();

  // Test endpoint for direct processor testing
  router.post('/test-processor/:type', async (req, res) => {
    try {
      const { type } = req.params;
      const { prompts, subscription_id, user_id } = req.body;

      logger.info('Test processor request received', {
        processor_type: type,
        prompts: prompts,
        subscription_id: subscription_id,
        user_id: user_id
      });

      // Validate inputs
      if (!type) {
        return res.status(400).json({
          status: 'error',
          error: 'Processor type is required'
        });
      }

      if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
        return res.status(400).json({
          status: 'error',
          error: 'Prompts must be a non-empty array'
        });
      }

      // Get the processor from the subscription processor
      let processor;
      if (type === 'boe') {
        processor = subscriptionProcessor.boeController;
      } else if (type === 'doga') {
        // Assuming you have a DOGA controller in your subscription processor
        processor = subscriptionProcessor.processorMap['doga'];
      } else {
        return res.status(400).json({
          status: 'error',
          error: `Unsupported processor type: ${type}`
        });
      }

      if (!processor) {
        return res.status(500).json({
          status: 'error',
          error: `Processor for type '${type}' is not initialized`
        });
      }

      // Create a test subscription object
      const testSubscription = {
        subscription_id: subscription_id || 'test-' + Date.now(),
        user_id: user_id || 'test-user-' + Date.now(),
        prompts: prompts,
        metadata: {
          test_mode: true,
          timestamp: new Date().toISOString()
        }
      };

      // Process the test subscription
      const result = await processor.processSubscription(testSubscription);

      return res.json({
        status: 'success',
        processor_type: type,
        result
      });
    } catch (error) {
      logger.error('Error in test processor endpoint', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  // Get processor status
  router.get('/processor-status', (req, res) => {
    try {
      const boeProcessor = subscriptionProcessor.boeController;
      const dogaProcessor = subscriptionProcessor.processorMap['doga'];

      const processorStatuses = {
        boe: {
          initialized: !!boeProcessor,
          has_process_method: boeProcessor ? typeof boeProcessor.processSubscription === 'function' : false,
          api_url: boeProcessor ? boeProcessor.apiUrl : null,
          api_key_present: boeProcessor ? !!boeProcessor.apiKey : false
        },
        doga: {
          initialized: !!dogaProcessor,
          has_process_method: dogaProcessor ? typeof dogaProcessor.processSubscription === 'function' : false,
          api_url: dogaProcessor ? dogaProcessor.apiUrl : null,
          api_key_present: dogaProcessor ? !!dogaProcessor.apiKey : false
        }
      };

      return res.json({
        status: 'success',
        processors: processorStatuses,
        available_processors: Object.keys(subscriptionProcessor.processorMap)
      });
    } catch (error) {
      logger.error('Error getting processor status', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  // Debug endpoint to get a list of pending subscriptions
  router.get('/pending-subscriptions', async (req, res) => {
    try {
      logger.debug('Fetching pending subscriptions for debug');
      
      const client = await pool.connect();
      
      try {
        // Query for pending subscriptions
        const result = await client.query(`
          SELECT 
            sp.id as processing_id,
            sp.subscription_id,
            sp.status,
            sp.next_run_at,
            sp.last_run_at,
            sp.error,
            s.user_id,
            s.type_id,
            st.name as type_name,
            s.active,
            s.prompts,
            s.frequency,
            s.last_check_at,
            s.created_at,
            s.updated_at
          FROM subscription_processing sp
          JOIN subscriptions s ON s.id = sp.subscription_id
          JOIN subscription_types st ON st.id = s.type_id
          WHERE sp.status = 'pending'
          ORDER BY sp.next_run_at ASC
        `);

        return res.json({
          status: 'success',
          count: result.rows.length,
          subscriptions: result.rows
        });
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error fetching pending subscriptions', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  // Debug endpoint to manually process a subscription
  router.post('/process-subscription/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      logger.info('Manual subscription processing requested', {
        subscription_id: id
      });

      if (!id) {
        return res.status(400).json({
          status: 'error',
          error: 'Subscription ID is required'
        });
      }

      // Process the subscription
      const result = await subscriptionProcessor.processSubscription(id);

      return res.json({
        status: 'success',
        result
      });
    } catch (error) {
      logger.error('Error processing subscription manually', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  // Get database connection status
  router.get('/database-status', async (req, res) => {
    let client = null;
    
    try {
      logger.debug('Checking database connection status');
      
      // Try to get a client from the pool
      client = await pool.connect();
      
      // Test the connection with a simple query
      const result = await client.query('SELECT NOW() as time');
      
      return res.json({
        status: 'success',
        connected: true,
        time: result.rows[0].time,
        pool_stats: {
          total_count: pool.totalCount,
          idle_count: pool.idleCount,
          waiting_count: pool.waitingCount
        }
      });
    } catch (error) {
      logger.error('Database connection test failed', {
        error: error.message,
        code: error.code
      });
      
      return res.status(500).json({
        status: 'error',
        connected: false,
        error: error.message,
        code: error.code
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  });

  // Get logs for a specific subscription
  router.get('/subscription-logs/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({
          status: 'error',
          error: 'Subscription ID is required'
        });
      }
      
      logger.debug('Fetching logs for subscription', {
        subscription_id: id
      });
      
      const client = await pool.connect();
      
      try {
        // Get basic subscription info
        const subscriptionResult = await client.query(`
          SELECT 
            s.id, 
            s.user_id, 
            s.type_id, 
            st.name as type_name,
            s.active,
            s.prompts,
            s.created_at,
            s.updated_at
          FROM subscriptions s
          JOIN subscription_types st ON st.id = s.type_id
          WHERE s.id = $1
        `, [id]);
        
        if (subscriptionResult.rowCount === 0) {
          return res.status(404).json({
            status: 'error',
            error: 'Subscription not found'
          });
        }
        
        // Get processing history
        const processingResult = await client.query(`
          SELECT 
            id as processing_id,
            status,
            error,
            next_run_at,
            last_run_at,
            created_at,
            updated_at
          FROM subscription_processing
          WHERE subscription_id = $1
          ORDER BY created_at DESC
        `, [id]);
        
        // Get notifications created for this subscription
        const notificationsResult = await client.query(`
          SELECT
            id as notification_id,
            title,
            content,
            source_url,
            read,
            created_at
          FROM notifications
          WHERE subscription_id = $1
          ORDER BY created_at DESC
          LIMIT 50
        `, [id]);
        
        return res.json({
          status: 'success',
          subscription: subscriptionResult.rows[0],
          processing_history: processingResult.rows,
          notifications: notificationsResult.rows,
          processing_count: processingResult.rowCount,
          notification_count: notificationsResult.rowCount
        });
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error fetching subscription logs', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  // Check for stuck or failed subscriptions
  router.get('/stuck-subscriptions', async (req, res) => {
    try {
      logger.debug('Checking for stuck or failed subscriptions');
      
      const client = await pool.connect();
      
      try {
        // Query for subscriptions that might be stuck in processing or have failed
        const result = await client.query(`
          SELECT 
            sp.id as processing_id,
            sp.subscription_id,
            sp.status,
            sp.next_run_at,
            sp.last_run_at,
            sp.error,
            sp.created_at as processing_created_at,
            sp.updated_at as processing_updated_at,
            s.user_id,
            s.type_id,
            st.name as type_name,
            s.active,
            s.prompts,
            s.frequency,
            s.created_at as subscription_created_at,
            s.updated_at as subscription_updated_at
          FROM subscription_processing sp
          JOIN subscriptions s ON s.id = sp.subscription_id
          JOIN subscription_types st ON st.id = s.type_id
          WHERE 
            (sp.status = 'processing' AND sp.updated_at < NOW() - INTERVAL '30 minutes')
            OR 
            (sp.status = 'failed' AND sp.updated_at > NOW() - INTERVAL '24 hours')
          ORDER BY sp.updated_at DESC
        `);

        return res.json({
          status: 'success',
          count: result.rows.length,
          stuck_subscriptions: result.rows
        });
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error checking for stuck subscriptions', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  // Initialize DOGA processor with custom URL and key for testing
  router.post('/initialize-doga', async (req, res) => {
    try {
      const { apiUrl, apiKey } = req.body;
      
      logger.info('Initializing DOGA processor with custom configuration', {
        api_url_provided: !!apiUrl,
        api_key_provided: !!apiKey
      });
      
      const DOGAProcessor = require('../services/processors/doga');
      
      // Create a new DOGA processor with the provided configuration
      const dogaProcessor = new DOGAProcessor({
        DOGA_API_URL: apiUrl,
        DOGA_API_KEY: apiKey
      });
      
      // Update the processor in the subscription processor
      subscriptionProcessor.processorMap['doga'] = dogaProcessor;
      
      // Test the connection
      let connectionStatus = 'unknown';
      try {
        // Make a simple ping request to check if the service is up
        const response = await dogaProcessor.client.get('/ping', { timeout: 5000 });
        connectionStatus = response.status >= 200 && response.status < 300 ? 'success' : 'error';
      } catch (pingError) {
        connectionStatus = 'error';
        logger.warn('Failed to ping DOGA service', {
          error: pingError.message,
          status: pingError.response?.status
        });
      }
      
      return res.json({
        status: 'success',
        processor: {
          type: 'doga',
          api_url: dogaProcessor.apiUrl,
          api_key_present: !!dogaProcessor.apiKey,
          connection_status: connectionStatus
        },
        message: 'DOGA processor initialized with custom configuration'
      });
    } catch (error) {
      logger.error('Error initializing DOGA processor', {
        error: error.message,
        stack: error.stack
      });
      
      return res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  return router;
}

module.exports = createDebugRouter; 