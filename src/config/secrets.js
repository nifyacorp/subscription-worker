const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { getLogger } = require('./logger');

class SecretsManager {
  constructor() {
    this.logger = getLogger('secrets');
    this.client = null;
  }

  async initialize() {
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