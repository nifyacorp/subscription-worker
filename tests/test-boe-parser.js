const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Set up the API client
const client = axios.create({
  baseURL: process.env.BOE_API_URL || 'https://boe-parser-415554190254.us-central1.run.app',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.BOE_API_KEY || 'test_key'}`
  }
});

// Log configuration
console.log('Configuration:', {
  baseURL: process.env.BOE_API_URL || 'https://boe-parser-415554190254.us-central1.run.app',
  apiKey: process.env.BOE_API_KEY ? '***' : 'missing'
});

async function testBOEParser() {
  console.log('Testing BOE Parser API...');
  
  try {
    // Create a test request that matches the expected format
    const requestBody = {
      texts: ['Resoluciones sobre empleo público', 'Anuncios sobre subvenciones medioambientales'],
      metadata: {
        user_id: 'test-user',
        subscription_id: 'test-subscription-123',
      },
      limit: 5,
      date: new Date().toISOString().split('T')[0]
    };
    
    console.log('Sending request to BOE API:', {
      endpoint: '/analyze-text',
      body: requestBody
    });
    
    // Make the request
    const response = await client.post('/analyze-text', requestBody);
    
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2).substring(0, 1000) + '...');
    
  } catch (error) {
    console.error('Error making request to BOE Parser:');
    console.error('Error message:', error.message);
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
      console.error('Response headers:', error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received. Request:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error setting up request:', error.message);
    }
  }
}

testBOEParser(); 