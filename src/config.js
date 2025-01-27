import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();

async function getSecret(name) {
  try {
    console.log(`🔐 Fetching secret: ${name}`);
    const [version] = await client.accessSecretVersion({
      name: `projects/${process.env.GOOGLE_CLOUD_PROJECT}/secrets/${name}/versions/latest`,
    });
    
    return version.payload.data.toString();
  } catch (error) {
    console.error(`❌ Error fetching secret ${name}:`, error);
    throw error;
  }
}

export async function loadSecrets() {
  console.log('🔄 Loading secrets from Secret Manager...');
  
  try {
    const [DB_NAME, DB_USER, DB_PASSWORD] = await Promise.all([
      getSecret('DB_NAME'),
      getSecret('DB_USER'),
      getSecret('DB_PASSWORD')
    ]);

    process.env.DB_NAME = DB_NAME;
    process.env.DB_USER = DB_USER;
    process.env.DB_PASSWORD = DB_PASSWORD;

    console.log('✅ Secrets loaded successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to load secrets:', error);
    throw error;
  }
}