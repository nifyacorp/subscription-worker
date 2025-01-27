import { PubSub } from '@google-cloud/pubsub';

export class PubSubClient {
  constructor() {
    this.client = new PubSub({
      projectId: process.env.GOOGLE_CLOUD_PROJECT
    });
    this.topicName = process.env.PUBSUB_TOPIC;
  }

  async publish(topic, messages) {
    const dataBuffer = Buffer.from(JSON.stringify(messages));
    try {
      const messageId = await this.client
        .topic(topic)
        .publish(dataBuffer);
      console.log(`Message ${messageId} published.`);
      return messageId;
    } catch (error) {
      console.error('Error publishing message:', error);
      throw error;
    }
  }
}