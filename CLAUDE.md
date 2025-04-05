# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- Development: `npm run dev` (runs with nodemon)
- Production: `npm start` (standard node)
- Test BOE parser: `node test-boe-parser.js`
- Debug endpoints: `/api/debug/status`, `/api/debug/test-processor/:type`, `/api/debug/test-db`

## Code Style Guidelines
- **JavaScript**: Modern ES6+ with Node.js compatibility
- **Imports**: Group by: 1) external modules, 2) config, 3) services, 4) utilities
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Error Handling**: Use try/catch with structured error objects; include context info in logs
- **Validation**: Use Zod schemas with safeParse pattern for all API inputs
- **Formatting**: 2-space indentation, 100 character line limit
- **Documentation**: JSDoc for public functions with @param and @returns tags
- **Logging**: Use configured logger with context objects, never console.log
- **Processors**: Extend the BaseProcessor class for subscription processors
- **API Structure**: Use middleware for validation and ensure helpful error messages
- **Database**: Always release connections in finally blocks and handle pool errors

## Architecture Patterns
- Modular API-based design with routes in /routes/api/ directory
- Business logic in service modules with clear separation of concerns
- Error responses should be helpful and guide users on proper API usage
- All database operations wrapped in transactions where appropriate
- Consistent response format: `{status, data}` or `{status, error, message}`