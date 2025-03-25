/**
 * Test Parser Protocol
 * 
 * This script tests the standardized parser protocol against the BOE parser service.
 * It verifies that the protocol handles connection issues properly, including socket hang up errors.
 */

const dotenv = require('dotenv');
const { ParserClient } = require('./src/utils/parser-protocol');

// Load environment variables
dotenv.config();

// Constants
const BOE_API_URL = process.env.BOE_API_URL || 'https://boe-parser-415554190254.us-central1.run.app';
const BOE_API_KEY = process.env.BOE_API_KEY || '';

// Simple console logger
const logger = {
  debug: (...args) => console.log('\x1b[34m[DEBUG]\x1b[0m', ...args),
  info: (...args) => console.log('\x1b[32m[INFO]\x1b[0m', ...args),
  warn: (...args) => console.log('\x1b[33m[WARN]\x1b[0m', ...args),
  error: (...args) => console.log('\x1b[31m[ERROR]\x1b[0m', ...args)
};

/**
 * Run tests for the parser protocol
 */
async function testParserProtocol() {
  logger.info('Starting Parser Protocol Test');
  logger.info('-'.repeat(50));
  
  // Create a parser client with our standardized protocol
  const parserClient = new ParserClient({
    baseURL: BOE_API_URL,
    apiKey: BOE_API_KEY,
    type: 'boe',
    logger
  });
  
  logger.info(`Parser Client Configuration:`);
  logger.info(`- Base URL: ${BOE_API_URL}`);
  logger.info(`- API Key Present: ${BOE_API_KEY ? 'Yes' : 'No'}`);
  logger.info(`- Using Keep-Alive: Yes`);
  logger.info('-'.repeat(50));
  
  // Test prompts
  const prompts = [
    'Resoluciones sobre empleo público',
    'Anuncios sobre subvenciones'
  ];
  
  logger.info('Test 1: Create Request');
  try {
    const requestBody = parserClient.createRequest(
      prompts,
      'test-user-' + Date.now(),
      'test-subscription-' + Date.now()
    );
    
    logger.info('Request created successfully');
    logger.info(`- Prompts: ${requestBody.texts.join(', ')}`);
    logger.info(`- User ID: ${requestBody.metadata.user_id}`);
    logger.info(`- Subscription ID: ${requestBody.metadata.subscription_id}`);
    logger.info(`- Date: ${requestBody.date}`);
    logger.info('✅ Test passed');
  } catch (error) {
    logger.error(`❌ Test failed: ${error.message}`);
  }
  
  logger.info('-'.repeat(50));
  logger.info('Test 2: Send Request to Parser');
  
  try {
    const requestBody = parserClient.createRequest(
      prompts,
      'test-user-' + Date.now(),
      'test-subscription-' + Date.now()
    );
    
    logger.info('Sending request to BOE parser...');
    const result = await parserClient.send(requestBody);
    
    logger.info('Response received:');
    logger.info(`- Status: ${result.status}`);
    logger.info(`- Entries count: ${result.entries.length}`);
    logger.info(`- Query date: ${result.query_date}`);
    
    if (result.status === 'success') {
      logger.info('✅ Test passed');
    } else {
      logger.error(`❌ Test failed: ${result.error || 'Unknown error'}`);
    }
  } catch (error) {
    logger.error(`❌ Test failed: ${error.message}`);
  }
  
  // Close the client connections
  parserClient.close();
  
  logger.info('-'.repeat(50));
  logger.info('Tests completed');
}

// Run the tests
testParserProtocol()
  .catch(error => {
    logger.error(`Test execution error: ${error.message}`);
    process.exit(1);
  });