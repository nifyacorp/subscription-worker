import express from 'express';

const app = express();
app.use(express.json());

// Basic endpoint for Pub/Sub messages
app.post('/subscription-events', (req, res) => {
  try {
    const message = req.body.message;
    console.log('📥 Received Pub/Sub message:', {
      messageId: message.messageId,
      publishTime: message.publishTime
    });
    console.log('✅ Acknowledged message:', message.messageId);
    res.status(204).send();
  } catch (error) {
    console.error('❌ Error processing message:', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).send('Internal Server Error');
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('OK');
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`🚀 Server started on port ${port}`);
});