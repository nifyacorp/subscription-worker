# Subscription Worker Guidelines

## Build Commands
- Development: `npm run dev` (run with nodemon)
- Production: `npm start` (standard node)
- Manual testing: 
  - `node test-boe-parser.js` (test BOE parser integration)
  - Use debug endpoints via API: `/api/debug/test-processor/:type`, `/api/debug/test-doga`

## Code Style Guidelines
- **JavaScript**: Modern ES6+ syntax with Node.js compatibility
- **Imports**: Group by external/internal with config imports first
- **Naming**: camelCase for variables/functions, PascalCase for classes/schemas
- **Error Handling**: Use try/catch blocks with specific error logging
- **Validation**: Use Zod schemas with safeParse pattern for all inputs
- **Formatting**: 2-space indentation, consistent spacing
- **Documentation**: JSDoc for public functions with @param and @returns tags
- **Logging**: Use configured logger with appropriate context objects
- **Types**: Use JSDoc or Zod schemas for type definitions
- **Processors**: Extend base processor class for consistent interface

## Architecture Patterns
- Modular service-based architecture
- Route handlers in routes/, business logic in services/
- Processor registry for extensible subscription types
- Database access through dedicated service modules
- Clean error handling with detailed error objects
- PubSub integration for event-driven notifications
- Environment-based configuration management