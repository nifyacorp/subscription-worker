import express from 'express';
import { PubSub } from '@google-cloud/pubsub';

const app = express();
app.use(express.json());

// Initialize Pub/Sub client
const pubsub = new PubSub();
const subscriptionName = 'subscription-events-sub';
const topicName = 'subscription-events';

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

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('OK');
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`🚀 Worker listening on port ${port}`);
});