import { DatabaseClient } from '../database/client.js';
import { PubSubClient } from '../services/pubsub.js';

export class ContentProcessor {
  constructor(parser, type) {
    this.parser = parser;
    this.type = type;
    this.db = new DatabaseClient();
    this.pubsub = new PubSubClient();
  }

  async process() {
    try {
      console.log(`Starting ${this.type} content processing...`);
      const startTime = Date.now();

      // Get all subscriptions for this type
      const subs = await this.getSubscriptionsGroupedByUser();
      const content = await this.parser.getLatest();
      
      // Process each user's subscriptions
      for (const [userId, userSubs] of Object.entries(subs)) {
        await this.processUserSubscriptions(userId, userSubs, content);
      }

      const duration = Date.now() - startTime;
      console.log(`${this.type} processing completed in ${duration}ms`);
    } catch (error) {
      console.error(`Error processing ${this.type} content:`, error);
      throw error;
    }
  }

  async getSubscriptionsGroupedByUser() {
    const allSubs = await this.db.getActiveSubscriptionsGroupedByType();
    const typeSubs = allSubs[this.type] || [];
    
    return typeSubs.reduce((acc, sub) => {
      if (!acc[sub.userId]) {
        acc[sub.userId] = [];
      }
      acc[sub.userId].push(sub);
      return acc;
    }, {});
  }

  async processUserSubscriptions(userId, subscriptions, content) {
    // Get unique prompts for this user
    const uniquePrompts = new Set(
      subscriptions.flatMap(sub => sub.prompts)
    );
    
    // Process each unique prompt once
    for (const prompt of uniquePrompts) {
      const matches = await this.parser.analyze(content, prompt);
      if (matches.length > 0) {
        // Create notifications for all matching subscriptions
        const matchingSubIds = subscriptions
          .filter(sub => sub.prompts.includes(prompt))
          .map(sub => sub.id);
          
        await this.notify(userId, matchingSubIds, matches);
      }
    }
  }

  async notify(userId, subscriptionIds, matches) {
    // Save to database
    const notifications = await Promise.all(
      subscriptionIds.map(subId => 
        this.db.createNotification({
          userId,
          subscriptionId: subId,
          content: matches,
          type: this.type
        })
      )
    );
    
    // Send real-time alert
    await this.pubsub.publish('notifications', notifications);
  }
}