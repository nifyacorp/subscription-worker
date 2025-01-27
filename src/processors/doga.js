import { ContentProcessor } from './content-processor.js';
import { DogaParserClient } from '../services/doga.js';

export class DogaProcessor extends ContentProcessor {
  constructor() {
    super(new DogaParserClient(), 'doga');
  }
}