/**
 * Legacy Code Cleanup Script
 * 
 * This script identifies and removes deprecated or redundant code
 * that's been replaced by the consolidated implementation.
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

const BACKUP_DIR = path.join(__dirname, '../.backup');

// Files that can be safely removed
const DEPRECATED_FILES = [
  'src/services/subscriptionProcessor.js',
  'src/routes/subscriptions/process.js',
  'src/routes/subscriptions/pending.js',
];

// Create backup directory if it doesn't exist
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Backup and remove deprecated files
async function cleanupFiles() {
  console.log('Starting legacy code cleanup');
  
  for (const filePath of DEPRECATED_FILES) {
    const fullPath = path.join(__dirname, '..', filePath);
    
    if (fs.existsSync(fullPath)) {
      try {
        // Create backup
        const backupPath = path.join(BACKUP_DIR, filePath.replace(/\//g, '_'));
        const content = await readFile(fullPath, 'utf8');
        await writeFile(backupPath, content, 'utf8');
        console.log(`✅ Backed up: ${filePath} -> ${backupPath}`);
        
        // Remove file
        await unlink(fullPath);
        console.log(`🗑️  Removed: ${filePath}`);
      } catch (error) {
        console.error(`❌ Error processing ${filePath}:`, error);
      }
    } else {
      console.log(`⚠️  File not found: ${filePath}`);
    }
  }
  
  console.log('\nLegacy code cleanup complete');
  console.log(`Backups saved to: ${BACKUP_DIR}`);
}

// Main execution
cleanupFiles().catch(error => {
  console.error('Error during cleanup:', error);
  process.exit(1);
});