import express from 'express';
import { PubSub } from '@google-cloud/pubsub';
import { loadSecrets } from './config.js';
import { initializeDatabase, closePool, getPool } from './database.js';

async function initializePubSub() {
  try {
    console.log('🔄 Initializing Pub/Sub client...');
    const pubsub = new PubSub();
    
    // Test connection by getting topic metadata
    const topic = pubsub.topic(process.env.PUBSUB_TOPIC);
    await topic.getMetadata();
    console.log('✅ Pub/Sub client initialized successfully');
    return pubsub;
  } catch (error) {
    console.error('❌ Failed to initialize Pub/Sub:', error);
    throw error;
  }
}

async function startServer() {
  let dbInitialized = false;
  let pubsubClient;

  try {
    console.log('🚀 Starting subscription worker initialization...');
    
    // Load secrets first
    console.log('📝 Step 1: Loading secrets...');
    await loadSecrets();
    
    // Try to initialize database connection
    console.log('📝 Step 2: Initializing database...');
    try {
      await initializeDatabase();
      dbInitialized = true;
    } catch (error) {
      console.error('⚠️ Database initialization failed, continuing without database:', error.message);
    }
    
    // Initialize Pub/Sub (but continue if it fails)
    console.log('📝 Step 3: Setting up Pub/Sub...');
    pubsubClient = await initializePubSub();

    console.log('📝 Step 4: Configuring Express server...');
    const app = express();
    app.use(express.json());
    
    // Health check endpoint
    app.get('/', (req, res) => {
      res.json({
        status: 'ok',
        database: dbInitialized,
        pubsub: true
      });
    });
    
    // Subscription events endpoint
    app.post('/subscription-events', async (req, res) => {
      try {
        const message = req.body.message;
        console.log('📥 Received message:', {
          messageId: message.messageId,
          publishTime: message.publishTime
        });

        if (!message || !message.data) {
          console.error('❌ Invalid message format');
          res.status(400).send('Invalid message format');
          return;
        }

        const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
        
        if (!dbInitialized) {
          console.warn('⚠️ Database not available, acknowledging message without processing');
          res.status(202).json({ status: 'acknowledged', processed: false });
          return;
        }

        console.log('📦 Message data:', JSON.stringify(data, null, 2));
        res.status(204).send();
      } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).send('Internal Server Error');
      }
    });

    // Graceful shutdown handling
    const shutdown = async () => {
      console.log('🛑 Shutting down server...');
      try {
        console.log('🔄 Closing Pub/Sub client...');
        try {
          await pubsubClient.close();
          console.log('✅ Pub/Sub client closed');
        } catch (error) {
          console.error('❌ Error closing Pub/Sub client:', error);
        }
        if (dbInitialized) {
          console.log('🔄 Closing database pool...');
          await closePool();
        }
      } catch (error) {}
      console.log('👋 Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    const port = process.env.PORT || 8080;
    console.log('📝 Step 5: Starting HTTP server...');
    app.listen(port, () => {
      console.log('✅ Server initialization complete!');
      console.log(`🚀 Worker listening on port ${port}`, {
        dbInitialized,
        pubsubInitialized: true
      });
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    try {
      try {
        await pubsubClient.close();
      } catch (e) {
        console.error('❌ Error during Pub/Sub cleanup:', e);
      }
      if (dbInitialized) await closePool();
    } catch (e) {}
    process.exit(1);
  }
}

startServer();