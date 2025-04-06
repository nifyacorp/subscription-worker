const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

let client;
let initialized = false;

class SecretsManager {
  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    this.envSecrets = {};
  }

  async initialize() {
    if (initialized) return;
    if (this.isDevelopment) {
      console.info('Running in development mode, using environment variables instead of Secret Manager');
      // Pre-load environment variables as secrets
      this.envSecrets = {
        'DB_NAME': process.env.DB_NAME || 'nifya_db',
        'DB_USER': process.env.DB_USER || 'postgres',
        'DB_PASSWORD': process.env.DB_PASSWORD || 'postgres',
        'EMAIL_IMMEDIATE_TOPIC_NAME': 'email-notifications-immediate',
        'EMAIL_DAILY_TOPIC_NAME': 'email-notifications-daily',
        'PARSER_API_KEY': process.env.BOE_API_KEY || 'test_key',
      };
      return;
    }

    if (!client) {
      try {
        client = new SecretManagerServiceClient();
        initialized = true;
        console.info('Secret Manager client initialized');
      } catch (error) {
        console.error('Failed to initialize Secret Manager client', { error: error.message });
        throw error;
      }
    }
  }

  async getSecret(secretName) {
    // Use environment variables in development mode
    if (this.isDevelopment) {
      const secretValue = this.envSecrets[secretName];
      console.debug('Using development secret', { secretName, valueExists: !!secretValue });
      return secretValue;
    }

    if (!client) {
      await this.initialize();
    }

    try {
      console.debug('Attempting to retrieve secret', { 
        secretName,
        projectId: process.env.PROJECT_ID,
        secretPath: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`
      });

      const [version] = await client.accessSecretVersion({
        name: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`,
      });

      console.debug('Secret retrieval details', { 
        secretName,
        secretExists: !!version,
        payloadExists: !!version?.payload,
        dataExists: !!version?.payload?.data
      });

      return version.payload.data.toString();
    } catch (error) {
      console.error('Failed to retrieve secret', { 
        error,
        errorName: error.name,
        errorCode: error.code,
        errorDetails: error.details,
        errorStack: error.stack,
        secretName,
        projectId: process.env.PROJECT_ID
      });
      throw error;
    }
  }
}

const secretsManager = new SecretsManager();

module.exports = {
  getSecret: (secretName) => secretsManager.getSecret(secretName),
  initialize: () => secretsManager.initialize()
};