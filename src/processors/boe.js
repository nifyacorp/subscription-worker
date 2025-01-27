import { ContentProcessor } from './content-processor.js';
import { BoeParserClient } from '../services/boe.js';

export class BoeProcessor extends ContentProcessor {
  constructor() {
    super(new BoeParserClient(), 'boe');
  }
}