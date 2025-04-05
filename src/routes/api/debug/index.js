/**
 * Debug API Routes
 * 
 * Provides endpoints for debugging and testing subscription processing.
 * These endpoints are only available in non-production environments
 * or when ENABLE_DEBUG_ROUTES is set to true.
 */

const express = require('express');
const { getLogger } = require('../../../config/logger');

const logger = getLogger('debug-api');

/**
 * Create debug router with all debug endpoints
 * @param {Object} options - Configuration options
 * @returns {Object} Express router for debug endpoints
 */
function createDebugRouter(options) {
  const { subscriptionProcessor, pool } = options;
  const router = express.Router();

  /**
   * GET /api/debug
   * Returns available debug endpoints and documentation
   */
  router.get('/', (req, res) => {
    // Return available debug endpoints and documentation
    res.status(200).json({
      status: 'success',
      message: 'Debug API documentation',
      available_endpoints: [
        {
          path: '/api/debug/status',
          method: 'GET',
          description: 'Check service status with detailed diagnostics',
          query_params: [],
          example_response: {
            status: 'success',
            service: {
              version: process.env.npm_package_version || '1.0.0',
              uptime: process.uptime(),
              node_env: process.env.NODE_ENV || 'unknown',
              memory_usage: process.memoryUsage(),
            },
            database: {
              connected: true,
              pool_size: 5,
              idle_count: 3,
              waiting_count: 0
            },
            processors: {
              available: ['boe', 'doga'],
              boe: { status: 'active', api_url: process.env.BOE_API_URL },
              doga: { status: 'active', api_url: process.env.DOGA_API_URL }
            }
          }
        },
        {
          path: '/api/debug/test-processor/:type',
          method: 'POST',
          description: 'Test a specific processor with sample data',
          params: [{ name: 'type', description: 'Processor type (boe, doga)' }],
          body: {
            prompts: ['search term 1', 'search term 2'],
            options: { limit: 5, date: '2023-01-01' }
          },
          example_response: {
            status: 'success',
            processor: 'boe',
            matches_count: 2,
            processing_time_ms: 1234,
            matches: [{ title: '...', summary: '...', relevance_score: 0.85 }]
          }
        },
        {
          path: '/api/debug/test-db',
          method: 'GET',
          description: 'Test database connection',
          query_params: [],
          example_response: {
            status: 'success',
            connection: { successful: true, latency_ms: 5 },
            schema: { tables: ['subscriptions', 'notifications'] }
          }
        },
        {
          path: '/api/debug/logs',
          method: 'GET',
          description: 'Get recent application logs',
          query_params: [
            { name: 'limit', description: 'Number of logs to return (default: 100)' },
            { name: 'level', description: 'Filter by log level (info, error, warn, debug)' }
          ],
          example_response: {
            status: 'success',
            logs: [
              { timestamp: '2023-01-01T00:00:00.000Z', level: 'info', message: 'Log message' }
            ],
            count: 1
          }
        }
      ]
    });
  });

  /**
   * GET /api/debug/status
   * Returns detailed service status
   */
  router.get('/status', async (req, res) => {
    try {
      const startTime = Date.now();
      
      // Collect service info
      const serviceInfo = {
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        node_env: process.env.NODE_ENV || 'unknown',
        memory_usage: process.memoryUsage(),
        platform: process.platform,
        node_version: process.version
      };
      
      // Check database connection
      let dbInfo = {
        connected: false,
        connection_error: 'Database pool not available'
      };
      
      if (pool) {
        try {
          const client = await pool.connect();
          
          // Basic query to test connection
          const queryStartTime = Date.now();
          await client.query('SELECT 1');
          const queryTime = Date.now() - queryStartTime;
          
          // Get some database stats
          dbInfo = {
            connected: true,
            query_latency_ms: queryTime,
            pool_total: pool.totalCount || 'unknown',
            pool_idle: pool.idleCount || 'unknown',
            pool_waiting: pool.waitingCount || 'unknown',
            mock_database: !!pool._mockPool
          };
          
          client.release();
        } catch (dbError) {
          dbInfo = {
            connected: false,
            connection_error: dbError.message,
            error_code: dbError.code,
            error_type: dbError.constructor.name
          };
        }
      }
      
      // Check processor status
      let processorInfo = {
        available: []
      };
      
      if (subscriptionProcessor) {
        const processorMap = subscriptionProcessor.processorMap || {};
        processorInfo.available = Object.keys(processorMap);
        
        // Add details for each processor
        for (const [key, processor] of Object.entries(processorMap)) {
          processorInfo[key] = {
            status: processor ? 'initialized' : 'unavailable',
            type: processor?.constructor?.name || 'unknown',
            has_process_method: processor && typeof processor.processSubscription === 'function'
          };
        }
      }
      
      // Calculate response time
      const responseTime = Date.now() - startTime;
      
      // Return all collected info
      res.status(200).json({
        status: 'success',
        timestamp: new Date().toISOString(),
        response_time_ms: responseTime,
        service: serviceInfo,
        database: dbInfo,
        processors: processorInfo,
        environment: {
          parser_base_url: process.env.PARSER_BASE_URL || 'not set',
          project_id: process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'not set',
          log_level: process.env.LOG_LEVEL || 'not set'
        }
      });
    } catch (error) {
      logger.error('Error in debug status endpoint', {
        error: error.message,
        stack: error.stack
      });
      
      res.status(500).json({
        status: 'error',
        error: 'Failed to retrieve service status',
        message: error.message
      });
    }
  });

  /**
   * POST /api/debug/test-processor/:type
   * Test a specific processor with sample data
   */
  router.post('/test-processor/:type', async (req, res) => {
    const { type } = req.params;
    const { prompts, options } = req.body;
    
    // Validate request parameters
    if (!type) {
      return res.status(400).json({
        status: 'error',
        error: 'Missing processor type',
        message: 'Please specify a processor type in the URL path, e.g., /api/debug/test-processor/boe',
        usage: {
          method: 'POST',
          path: '/api/debug/test-processor/:type',
          params: [{ name: 'type', description: 'Processor type (boe, doga)' }],
          body: {
            prompts: ['search term 1', 'search term 2'],
            options: { limit: 5, date: '2023-01-01' }
          }
        }
      });
    }
    
    // Check if processor exists
    if (!subscriptionProcessor || !subscriptionProcessor.processorMap || !subscriptionProcessor.processorMap[type]) {
      return res.status(404).json({
        status: 'error',
        error: 'Processor not found',
        message: `Processor '${type}' is not available. Available processors: ${
          subscriptionProcessor?.processorMap ? Object.keys(subscriptionProcessor.processorMap).join(', ') : 'none'
        }`,
        available_processors: subscriptionProcessor?.processorMap ? Object.keys(subscriptionProcessor.processorMap) : []
      });
    }
    
    // Validate prompts
    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({
        status: 'error',
        error: 'Invalid prompts',
        message: 'Please provide an array of prompt strings',
        example: {
          prompts: ['search term 1', 'search term 2'],
          options: { limit: 5, date: '2023-01-01' }
        }
      });
    }
    
    // Get processor
    const processor = subscriptionProcessor.processorMap[type];
    
    try {
      logger.info(`Testing ${type} processor`, { prompts, options });
      
      const startTime = Date.now();
      
      // Create test data
      const testData = {
        subscription_id: 'test-' + Date.now(),
        user_id: 'debug-user',
        prompts: prompts,
        metadata: {
          test: true,
          options: options || {}
        }
      };
      
      // Process the test data
      const result = await processor.processSubscription(testData);
      
      const processingTime = Date.now() - startTime;
      
      // Add test metadata to result
      result.test_metadata = {
        processing_time_ms: processingTime,
        processor_type: type,
        processor_constructor: processor.constructor.name,
        test_timestamp: new Date().toISOString()
      };
      
      res.status(200).json({
        status: 'success',
        processor: type,
        processing_time_ms: processingTime,
        result: result
      });
    } catch (error) {
      logger.error(`Error testing ${type} processor`, {
        error: error.message,
        stack: error.stack,
        prompts,
        options
      });
      
      res.status(500).json({
        status: 'error',
        error: `Error testing ${type} processor`,
        message: error.message,
        processor: type
      });
    }
  });

  /**
   * GET /api/debug/test-db
   * Test database connection
   */
  router.get('/test-db', async (req, res) => {
    try {
      if (!pool) {
        return res.status(503).json({
          status: 'error',
          error: 'Database pool not available',
          message: 'The database pool is not initialized or not available'
        });
      }
      
      // Track start time for latency calculation
      const startTime = Date.now();
      
      // Get a client from the pool
      const client = await pool.connect();
      
      try {
        // Do a simple query to test connection
        await client.query('SELECT 1 as connection_test');
        
        // Get database schema information
        const tablesResult = await client.query(`
          SELECT table_name, table_schema
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name
        `);
        
        // Get summary counts
        const countQueries = await Promise.all([
          client.query('SELECT COUNT(*) as subscription_count FROM subscriptions'),
          client.query('SELECT COUNT(*) as notification_count FROM notifications'),
          client.query('SELECT COUNT(*) as processing_count FROM subscription_processing')
        ]);
        
        // Calculate query latency
        const latency = Date.now() - startTime;
        
        // Prepare the response
        res.status(200).json({
          status: 'success',
          connection: {
            successful: true,
            latency_ms: latency,
            pool_stats: {
              total: pool.totalCount || 'unknown',
              idle: pool.idleCount || 'unknown',
              waiting: pool.waitingCount || 'unknown'
            }
          },
          schema: {
            tables: tablesResult.rows.map(row => row.table_name)
          },
          database_stats: {
            subscription_count: parseInt(countQueries[0].rows[0].subscription_count),
            notification_count: parseInt(countQueries[1].rows[0].notification_count),
            processing_count: parseInt(countQueries[2].rows[0].processing_count)
          }
        });
      } finally {
        // Always release the client
        client.release();
      }
    } catch (error) {
      logger.error('Database test failed', {
        error: error.message,
        code: error.code,
        stack: error.stack
      });
      
      res.status(500).json({
        status: 'error',
        error: 'Database test failed',
        message: error.message,
        error_code: error.code,
        error_type: error.constructor.name
      });
    }
  });

  /**
   * GET /api/debug/logs
   * Get recent application logs
   */
  router.get('/logs', async (req, res) => {
    try {
      // This is a placeholder - in a real implementation, you would query
      // your logging system (e.g., Cloud Logging) for actual logs
      
      const limit = parseInt(req.query.limit) || 100;
      const level = req.query.level;
      
      // Simulate logs for the debug endpoint
      const logs = [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Debug logs endpoint accessed',
          context: {
            ip: req.ip,
            user_agent: req.get('user-agent'),
            query_params: req.query
          }
        },
        {
          timestamp: new Date(Date.now() - 60000).toISOString(),
          level: 'info',
          message: 'Server started',
          context: {
            node_env: process.env.NODE_ENV,
            port: process.env.PORT
          }
        }
      ];
      
      // Filter by level if provided
      const filteredLogs = level ? logs.filter(log => log.level === level) : logs;
      
      res.status(200).json({
        status: 'success',
        message: 'This is a simulated log endpoint. In production, connect to your actual logging service.',
        logs: filteredLogs.slice(0, limit),
        count: filteredLogs.length,
        query: {
          limit,
          level
        }
      });
    } catch (error) {
      logger.error('Error retrieving logs', {
        error: error.message,
        stack: error.stack
      });
      
      res.status(500).json({
        status: 'error',
        error: 'Failed to retrieve logs',
        message: error.message
      });
    }
  });

  return router;
}

module.exports = createDebugRouter;