import express from 'express';
import { PubSub } from '@google-cloud/pubsub';
import { loadSecrets } from './config.js';
import { initializeDatabase, closePool } from './database.js';

async function startServer() {
  try {
    console.log('🚀 Starting subscription worker...');
    
    // Load secrets first
    await loadSecrets();
    
    // Initialize database connection
    await initializeDatabase();

    const app = express();
    app.use(express.json());

    // Initialize Pub/Sub client
    const pubsub = new PubSub();

    // Basic endpoint for Pub/Sub push messages
    app.post('/subscription-events', (req, res) => {
      try {
        const message = req.body.message;
        console.log('📥 Received message:', {
          messageId: message.messageId,
          publishTime: message.publishTime
        });

        const data = message.data ? 
          JSON.parse(Buffer.from(message.data, 'base64').toString()) : 
          null;

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
      await closePool();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    const port = process.env.PORT || 8080;
    app.listen(port, () => {
      console.log(`🚀 Worker listening on port ${port}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
