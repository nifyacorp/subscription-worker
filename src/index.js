import 'dotenv/config';
import { DogaProcessor } from './processors/doga.js';
import { BoeProcessor } from './processors/boe.js';

async function main() {
  try {
    console.log('Starting subscription processing...');
    
    // Initialize processors
    const dogaProcessor = new DogaProcessor();
    const boeProcessor = new BoeProcessor();
    
    // Process content from all sources
    await Promise.all([
      dogaProcessor.process(),
      boeProcessor.process()
    ]);
    
    console.log('Processing completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Processing failed:', error);
    process.exit(1);
  }
}

main();