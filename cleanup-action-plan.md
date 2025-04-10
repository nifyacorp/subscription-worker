# Subscription Worker Cleanup Action Plan

Based on the recommendations in `cleanup-recommendations.md` and subsequent evaluation, this file outlines the specific actions to take to clean up the repository.

## 1. Files to Delete

Run the following commands to remove unnecessary files:

```bash
# Remove duplicate/outdated entry point
rm index-updated.js

# Remove log files (and add to .gitignore)
rm log.txt
echo "log.txt" >> .gitignore
echo "*.log" >> .gitignore

# Remove AI assistance documentation
rm CLAUDE.md

# Remove historical reports (after consolidation)
# Note: You may want to archive these somewhere first if valuable
rm cleanup-summary.md
rm fixes-summary.md
rm spaghetti-code-report.md
rm code-quality-report.md

# Remove typo file
rm ubscription-worker
```

## 2. Move Test Files to Proper Test Directory

```bash
# Create a proper test directory
mkdir -p tests

# Move test scripts to test directory
mv test-debug-endpoints.sh tests/
mv test-boe-parser.js tests/
mv test-parser-protocol.js tests/
```

## 3. Organize Documentation

```bash
# Create proper documentation structure
mkdir -p docs/architecture
mkdir -p docs/reports

# Move architecture documentation
mv ARCHITECTURE.md docs/architecture/
mv ENDPOINTS.md docs/architecture/

# Create consolidated reports document
touch docs/reports/code-analysis-summary.md
# Note: You'll need to manually consolidate the content from the old report files
```

## 4. Environment Configuration

```bash
# Create example environment file (if not exists)
cp .env .env.example

# Edit .env.example to remove any sensitive values
# (manual step)
```

## 5. Move Deployment Scripts

```bash
# Create deployment directory
mkdir -p scripts/deployment

# Move deployment scripts
mv create-secrets.sh scripts/deployment/
```

## 6. .backup Directory

```bash
# Option 1: Delete backup directory if content no longer needed
rm -rf .backup/

# Option 2: Archive it
# tar -czf backup-archive.tar.gz .backup/
# rm -rf .backup/
```

## 7. Review and Modularize Large Files

The following files should be reviewed and potentially refactored:

1. `src/routes/debug.js` - Break down into smaller modules

```bash
# Create directory structure for modularized debug routes
mkdir -p src/routes/debug

# Create new files (manual step)
touch src/routes/debug/index.js
touch src/routes/debug/system-routes.js
touch src/routes/debug/subscription-routes.js
touch src/routes/debug/parser-routes.js
# ... add other route files as appropriate

# Move content from the original file into these new files
# (manual step)
```

## 8. Additional Cleanup Tasks

- Review `src/utils/parser-protocol.js` and `src/clients/ParserClient.js` for potential simplification in the abstraction (not duplication)
- Review `src/routes/legacy/index.js` to confirm if it can be safely removed after ensuring all clients use the new API endpoints
- Perform dependency audit with `npm prune` and remove any unused dependencies
- Configure a linter (ESLint) if not already set up
- Review logging to ensure consistent levels and context information

## 9. Next Steps for Future Improvements

- Create a proper test suite (consider Jest or Mocha)
- Implement consistent error handling across all services
- Consider adding TypeScript typing for better code quality
- Create a proper CI/CD pipeline configuration 