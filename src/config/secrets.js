const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { getLogger } = require('./logger');

const logger = getLogger('secrets');
const secretManager = new SecretManagerServiceClient();

async function getSecret(secretName) {
  try {
    logger.debug({ secretName }, 'Retrieving secret');
    const [version] = await secretManager.accessSecretVersion({
      name: `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`,
    });
    logger.debug({ secretName }, 'Successfully retrieved secret');
    return version.payload.data.toString();
  } catch (error) {
    logger.error({ error, secretName }, 'Failed to retrieve secret');
    throw error;
  }
}

module.exports = { getSecret };