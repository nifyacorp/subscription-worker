/**
 * Subscription Worker
 * Main application entry point
 */
const express = require('express');
const { promisify } = require('util');
require('dotenv').config();

// Import application parts
const { 
    SubscriptionRepository,
    NotificationRepository, 
    ProcessTrackingRepository 
} = require('./repositories');

const { SubscriptionService } = require('./services/SubscriptionService');
const { SubscriptionController } = require('./controllers/SubscriptionController');
const ParserClient = require('./clients/ParserClient');
const NotificationClient = require('./clients/NotificationClient');
const { getSecret } = require('./config/secrets');
const { process } = require('./utils');
const createApiRouter = require('./routes/api/index');
const { createHealthRouter } = require('./routes/health');
const processRouter = require('./routes/process'); // Import the new process router

// Constants
const DEFAULT_PORT = 8080;

// Database connection
const { Pool } = require('pg');
const { createPoolConfig } = require('./config/database');

// Flag for running with mock database (when no DB connection available)
let mockDatabaseMode = false;
let server = null;

/**
 * Creates the database pool
 * @returns {Promise<object>} Database connection pool or null if mock mode
 */
async function createDatabasePool() {
    try {
        const dbOptions = await createPoolConfig();
        console.info('Creating database pool with options:', {
            host: dbOptions.host,
            database: dbOptions.database,
            port: dbOptions.port,
            has_user: !!dbOptions.user,
            has_password: !!dbOptions.password,
            app_name: dbOptions.application_name,
        });
        
        const pool = new Pool(dbOptions);
        
        // Verify database connection
        try {
            const client = await pool.connect();
            console.info('Database connection established successfully.');
            client.release();
            return pool;
        } catch (dbError) {
            console.error('Database connection verification failed:', {
                error: dbError.message, 
                code: dbError.code
            });
            
            mockDatabaseMode = true;
            return null;
        }
    } catch (error) {
        console.error('Database pool creation failed:', {
            error: error.message,
            stack: error.stack
        });
        
        mockDatabaseMode = true;
        return null;
    }
}

/**
 * Initialize external service clients
 */
async function initializeClients() {
    try {
        console.log('[DEBUG initializeClients] Starting client initialization');
        
        // Initialize parser client
        const parserClient = new ParserClient({});
        await parserClient.initialize();
        const parserApiKey = parserClient.parserApiKey;
        
        console.log('[DEBUG initializeClients] Parser client initialized, setting up notification client');
        
        // Initialize notification client
        // Use globalThis.process to avoid conflicts with the imported 'process' utility
        const pubsubProject = globalThis.process.env.PROJECT_ID || 
                              globalThis.process.env.GOOGLE_CLOUD_PROJECT || 
                              'local-dev-project';
                              
        console.log('[DEBUG initializeClients] Using project ID:', pubsubProject);
        
        // Create notification client with a project ID - which can be null in development
        const notificationClient = new NotificationClient({
            projectId: pubsubProject,
            topicName: globalThis.process.env.NOTIFICATION_TOPIC || 'subscription-notifications'
        });
        
        console.log('[DEBUG initializeClients] All clients initialized successfully');
        
        return { parserClient, notificationClient, parserApiKey };
    } catch (error) {
        console.error('[DEBUG initializeClients] Error initializing clients:', error);
        throw error;
    }
}

/**
 * Registers application routes.
 */
function registerRoutes(app, dependencies) {
    console.info('Registering application routes...');
    const { 
        pool, 
        subscriptionController, 
        subscriptionService,
        parserApiKey 
    } = dependencies;

    // Health Check Routes
    app.use(createHealthRouter(pool));
    console.debug('Registered health routes.');

    // Process Route - For backend scheduler integration
    app.use(processRouter);
    console.debug('Registered process route for scheduler integration.');

    // Primary API Routes
    app.use('/api', createApiRouter({ subscriptionController, parserApiKey, pool })); 
    console.debug('Registered API routes under /api.');

    // Debug Routes - Always enable for subscription type management
    try {
        console.info('Attempting to register debug routes under /debug...');
        const createDebugRouter = require('./routes/debug');
        app.use('/debug', createDebugRouter(subscriptionService, pool));
        console.info('[SUCCESS] Debug routes registered under /debug.');
    } catch (error) {
        console.error('Failed to register debug routes:', {
            error_message: error.message,
            error_stack: error.stack
        });
    }

    // Redirect any legacy paths to the primary API endpoint
    app.use((req, res, next) => {
        // Skip API paths, health checks, or root
        if (req.path.startsWith('/api/') || 
            req.path === '/' || 
            req.path === '/health' || 
            req.path === '/_health' ||
            req.path.startsWith('/debug/') ||
            req.path === '/process') { // Add process to the exclusion list
            return next();
        }
        
        // Handle legacy process-subscription endpoint directly 
        // (no need for a separate legacy router)
        if (req.path.includes('/process-subscription/')) {
            const parts = req.path.split('/');
            const idIndex = parts.indexOf('process-subscription') + 1;
            
            if (idIndex < parts.length) {
                const id = parts[idIndex];
                console.debug(`Redirecting legacy endpoint: ${req.path} -> /api/subscriptions/process/${id}`);
                return res.redirect(307, `/api/subscriptions/process/${id}`);
            }
        }

        // Handle legacy subscriptions/process-subscription endpoint
        if (req.path.includes('/subscriptions/process-subscription/')) {
            const parts = req.path.split('/');
            const idIndex = parts.indexOf('process-subscription') + 1;
            
            if (idIndex < parts.length) {
                const id = parts[idIndex];
                console.debug(`Redirecting legacy endpoint: ${req.path} -> /api/subscriptions/process/${id}`);
                return res.redirect(307, `/api/subscriptions/process/${id}`);
            }
        }
        
        // For other paths
        next();
    });

    console.info('Application routes registered.');
}

/**
 * Register error handlers
 */
function registerErrorHandlers(app) {
    // 404 handler
    app.use((req, res, next) => {
        res.status(404).json({
            status: 'error',
            error: 'Not Found',
            message: `The requested path ${req.path} was not found`
        });
    });
    
    // Global error handler
    app.use((err, req, res, next) => {
        console.error('Unhandled error in request:', {
            path: req.path,
            method: req.method,
            error: err.message,
            stack: err.stack
        });
        
        res.status(err.status || 500).json({
            status: 'error',
            error: err.message || 'Internal Server Error',
            code: err.code
        });
    });
}

/**
 * Main application startup function
 */
async function startServer() {
    let pool;

    try {
        // Initialize database
        console.info('Initializing database connection...');
        pool = await createDatabasePool();
        
        if (mockDatabaseMode) {
            console.warn('Running in MOCK DATABASE MODE - Limited functionality');
            // Create a minimal pool object to avoid null errors
            pool = {
                query: async () => { 
                    console.debug('[MOCK DB] Query called, returning empty result');
                    return { rows: [], rowCount: 0 }; 
                },
                connect: async () => {
                    console.debug('[MOCK DB] Connect called');
                    return { 
                        query: async () => ({ rows: [], rowCount: 0 }),
                        release: () => {} 
                    };
                },
                end: async () => { console.debug('[MOCK DB] End called'); }
            };
        } else {
            console.info('Database connection established successfully');
        }
        
        // Initialize external service clients
        const { parserClient, notificationClient, parserApiKey } = await initializeClients();
        
        console.log('Creating repositories with pool:', !!pool);
        
        // Initialize repositories
        const subscriptionRepository = new SubscriptionRepository(pool);
        const notificationRepository = new NotificationRepository(pool);
        const processTrackingRepository = new ProcessTrackingRepository(pool);

        // Initialize service
        const subscriptionService = new SubscriptionService({
            subscriptionRepository,
            notificationRepository,
            parserClient,
            notificationClient,
        });

        // Initialize controller
        const subscriptionController = new SubscriptionController({
            subscriptionService,
            processTrackingRepository
        });

        // Collect dependencies needed for routing
        const routeDependencies = {
            pool,
            subscriptionController,
            subscriptionService,
            parserApiKey
        };
        console.info('Application components instantiated.');

        // Setup Express App
        const app = express();
        app.locals.mockDatabaseMode = mockDatabaseMode;
        app.use(express.json());
        
        // Middleware to check mock DB status for database operations
        app.use((req, res, next) => {
            if (mockDatabaseMode && (
                req.path.includes('/process') || 
                req.path.includes('/batch')
            )) {
                console.warn('Attempt to use DB-dependent endpoint in mock mode', { path: req.path });
                return res.status(503).json({ 
                    status: 'error', 
                    error: 'Database unavailable in mock mode' 
                });
            }
            next();
        });

        // Register Routes
        registerRoutes(app, routeDependencies);
        
        // Register Error Handlers (must be last)
        registerErrorHandlers(app);

        // Start Server
        const port = globalThis.process.env.PORT || DEFAULT_PORT;
        server = app.listen(port, () => {
            console.info({ port, node_env: globalThis.process.env.NODE_ENV }, `Server listening on port ${port}`);
        });
        
        process.setupGracefulShutdown(server, pool);
        console.info('--- Subscription Worker Started Successfully ---');

    } catch (error) {
        console.error('Failed to start server:', {
            error: error.message, 
            stack: error.stack
        });
        // Use global.process instead of process to avoid conflict with the imported process utility
        globalThis.process.exit(1);
    }
}

// Start the server
startServer().catch(error => {
    console.error('Unhandled error during startup:', {
        error: error.message, 
        stack: error.stack
    });
    // Use global.process instead of process to avoid conflict with the imported process utility
    globalThis.process.exit(1);
});