const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { getLogger } = require('./logger');

class SecretsManager {
  constructor() {
    this.logger = getLogger('secrets');
    this.client = null;
    this.isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    this.envSecrets = {};
  }

  async initialize() {
    if (this.isDevelopment) {
      this.logger.info('Running in development mode, using environment variables instead of Secret Manager');
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

    if (!this.client) {
      try {
        this.client = new SecretManagerServiceClient();
        this.logger.info('Secret Manager client initialized');
      } catch (error) {
        this.logger.error({ error }, 'Failed to initialize Secret Manager client');
        throw error;
      }
    }
  }

  async getSecret(secretName) {
    // Use environment variables in development mode
    if (this.isDevelopment) {
      const secretValue = this.envSecrets[secretName];
      this.logger.debug({ secretName, valueExists: !!secretValue }, 'Using development secret');
      return secretValue;
    }

    if (!this.client) {
      await this.initialize();
    }

    try {
      this.logger.debug({ 
        secretName,
        projectId: process.env.PROJECT_ID,
        secretPath: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`
      }, 'Attempting to retrieve secret');

      const [version] = await this.client.accessSecretVersion({
        name: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`,
      });

      this.logger.debug({ 
        secretName,
        secretExists: !!version,
        payloadExists: !!version?.payload,
        dataExists: !!version?.payload?.data
      }, 'Secret retrieval details');

      return version.payload.data.toString();
    } catch (error) {
      this.logger.error({ 
        error,
        errorName: error.name,
        errorCode: error.code,
        errorDetails: error.details,
        errorStack: error.stack,
        secretName,
        projectId: process.env.PROJECT_ID
      }, 'Failed to retrieve secret');
      throw error;
    }
  }
}

const secretsManager = new SecretsManager();

module.exports = {
  getSecret: (secretName) => secretsManager.getSecret(secretName),
  initialize: () => secretsManager.initialize()
};