import { DatabaseClient } from '../database/client.js';
import { DogaProcessor } from '../processors/doga.js';
import { BoeProcessor } from '../processors/boe.js';

export async function processSubscriptionEvent(event) {
  console.log('🔄 Processing subscription event:', {
    type: event.type,
    subscriptionId: event.data?.subscriptionId,
    userId: event.data?.userId,
    frequency: event.data?.frequency,
    promptCount: event.data?.prompts?.length
  });

  // Validate event structure
  if (event.type !== 'subscription-created') {
    console.error('❌ Invalid event type:', event.type);
    throw { status: 400, message: 'Unsupported event type' };
  }

  const { userId, subscriptionId, prompts, frequency } = event.data;
  if (!userId || !subscriptionId || !prompts || !frequency) {
    console.error('❌ Missing required fields:', {
      hasUserId: !!userId,
      hasSubscriptionId: !!subscriptionId,
      hasPrompts: !!prompts,
      hasFrequency: !!frequency
    });
    throw { status: 400, message: 'Missing required fields' };
  }

  // For immediate frequency, process right away
  if (frequency === 'immediate') {
    console.log('⚡ Processing immediate subscription:', subscriptionId);
    await processImmediateSubscription(event.data);
  } else {
    console.log('📅 Skipping daily subscription:', subscriptionId);
  }
}

async function processImmediateSubscription({ userId, subscriptionId, prompts }) {
  const db = new DatabaseClient();
  
  try {
    console.log('🔍 Processing subscription:', {
      userId,
      subscriptionId,
      promptCount: prompts.length
    });

    // Initialize processors
    const processors = {
      doga: new DogaProcessor(),
      boe: new BoeProcessor()
    };

    // Get the subscription details to determine type
    const query = `
      SELECT type
      FROM subscriptions
      WHERE id = $1 AND user_id = $2
    `;
    const { rows } = await db.pool.query(query, [subscriptionId, userId]);
    
    if (rows.length === 0) {
      console.error('❌ Subscription not found:', subscriptionId);
      throw { status: 400, message: 'Subscription not found' };
    }

    const { type } = rows[0];
    console.log('📋 Found subscription type:', type);

    const processor = processors[type];
    
    if (!processor) {
      console.error('❌ Invalid subscription type:', type);
      throw { status: 400, message: 'Invalid subscription type' };
    }

    // Get latest content
    console.log('📥 Fetching latest content for type:', type);
    const content = await processor.parser.getLatestContent();
    
    // Process each prompt
    for (const [index, prompt] of prompts.entries()) {
      console.log(`🔍 Processing prompt ${index + 1}/${prompts.length}:`, prompt);
      const matches = await processor.parser.analyze(content, prompt);
      
      if (matches.length > 0) {
        console.log('✨ Found matches:', {
          prompt,
          matchCount: matches.length
        });
        await processor.notify(userId, [subscriptionId], matches);
      } else {
        console.log('ℹ️ No matches found for prompt:', prompt);
      }
    }
    
    console.log('✅ Successfully processed subscription:', subscriptionId);
  } catch (error) {
    console.error('❌ Error processing immediate subscription:', {
      error: error.message,
      stack: error.stack,
      subscriptionId,
      userId
    });
    throw error;
  }
}