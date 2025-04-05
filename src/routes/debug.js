const express = require('express');

function createDebugRouter(subscriptionProcessor, pool) {
  const router = express.Router();

  // Test endpoint for direct processor testing
  router.post('/test-processor/:type', async (req, res) => {
    try {
      const { type } = req.params;
      const { prompts, subscription_id, user_id } = req.body;

      console.info('Test processor request received', { processor_type: type });

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
      console.error('Error in test processor endpoint', { error: error.message });

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
      return res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  // Debug endpoint to get a list of pending subscriptions
  router.get('/pending-subscriptions', async (req, res) => {
    try {
      console.debug('Fetching pending subscriptions for debug');
      
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
      console.error('Error fetching pending subscriptions', {
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
      
      console.info('Manual subscription processing requested', {
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
      console.error('Error processing subscription manually', {
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
      console.debug('Checking database connection status');
      
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
      console.error('Database connection test failed', {
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
      
      console.debug('Fetching logs for subscription', {
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
      console.error('Error fetching subscription logs', {
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
      console.debug('Checking for stuck or failed subscriptions');
      
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
      console.error('Error checking for stuck subscriptions', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  // Add endpoint to initialize DOGA processor with custom settings
  router.post('/initialize-doga', async (req, res) => {
    try {
      const { apiUrl, apiKey } = req.body;
      const logger = req.app.get('logger');
      
      logger.info('Initializing DOGA processor with custom settings', {
        apiUrl: apiUrl ? 'provided' : 'not provided',
        apiKey: apiKey ? 'provided (length: ' + apiKey.length + ')' : 'not provided'
      });

      // Import the DOGA processor
      const DOGAProcessor = require('../services/processors/doga');
      
      // Create a new instance with the provided configuration
      const dogaProcessor = new DOGAProcessor({
        DOGA_API_KEY: apiKey,
        DOGA_API_URL: apiUrl
      });

      // Update the processor map in the subscription processor
      const subscriptionProcessor = req.app.get('subscriptionProcessor');
      subscriptionProcessor.dogaController = dogaProcessor;
      subscriptionProcessor.processorMap['doga'] = dogaProcessor;

      // Test the connection
      let connectionStatus = 'unknown';
      try {
        // Try to ping the DOGA service
        await dogaProcessor.client.get('/ping');
        connectionStatus = 'connected';
      } catch (pingError) {
        logger.error('Failed to connect to DOGA service', {
          error: pingError.message,
          stack: pingError.stack
        });
        connectionStatus = 'failed';
      }

      return res.json({
        success: true,
        message: 'DOGA processor initialized with custom settings',
        processor: {
          type: 'doga',
          apiUrl: apiUrl || 'not provided',
          hasApiKey: !!apiKey,
          connectionStatus
        }
      });
    } catch (error) {
      req.app.get('logger').error('Error initializing DOGA processor', {
        error: error.message,
        stack: error.stack
      });
      
      return res.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Add a new endpoint to test the DOGA processor
  router.post('/test-doga', async (req, res) => {
    try {
      const logger = req.app.get('logger');
      logger.info('Testing DOGA processor', { body: req.body });

      const subscriptionProcessor = req.app.get('subscriptionProcessor');
      const dogaProcessor = subscriptionProcessor.processorMap['doga'];
      
      if (!dogaProcessor) {
        logger.error('DOGA processor not found in processor map');
        return res.status(500).json({
          success: false,
          error: 'DOGA processor not initialized'
        });
      }

      // Create a test subscription object
      const testSubscription = {
        id: 'test-doga-' + Date.now(),
        type: 'doga',
        config: req.body.config || {
          keywords: ['test', 'prueba'],
          sections: ['all']
        },
        lastProcessedDate: null
      };

      logger.info('Processing test DOGA subscription', { subscription: testSubscription });
      
      // Process the test subscription
      const result = await dogaProcessor.processSubscription(testSubscription);
      
      logger.info('DOGA test processing completed', { result });
      
      return res.json({
        success: true,
        message: 'DOGA processor test completed',
        result
      });
    } catch (error) {
      req.app.get('logger').error('Error testing DOGA processor', {
        error: error.message,
        stack: error.stack
      });
      
      return res.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  return router;
}

module.exports = createDebugRouter; 