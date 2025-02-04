const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { getLogger } = require('./logger');

const logger = getLogger('secrets');
const secretManager = new SecretManagerServiceClient();

async function getSecret(secretName) {
  try {
    logger.debug({ 
      secretName,
      projectId: process.env.PROJECT_ID,
      secretPath: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`
    }, 'Attempting to retrieve secret');

    const [version] = await secretManager.accessSecretVersion({
      name: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`,
    });

    logger.debug({ 
      secretName,
      secretExists: !!version,
      payloadExists: !!version?.payload,
      dataExists: !!version?.payload?.data
    }, 'Secret retrieval details');

    return version.payload.data.toString();
  } catch (error) {
    logger.error({ 
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