# Subscription Worker Architecture

## Overview

The Subscription Worker is a service responsible for processing subscriptions to various data sources (BOE, DOGA, etc.) and creating notifications when matches are found. It provides a RESTful API for managing and processing subscriptions.

## Architecture

### Core Components

1. **Main Application (src/index.js)**
   - Entry point for the application
   - Configures Express server and middleware
   - Initializes core services
   - Manages database connection
   - Sets up route handlers

2. **Subscription Processor (src/services/subscription/index.js)**
   - Core business logic for processing subscriptions
   - Supports multiple processor types (BOE, DOGA)
   - Handles database operations
   - Creates notifications for matches

3. **Route Handlers**
   - API Routes (`/api/*`): Main REST API endpoints
   - Legacy Routes: For backward compatibility
   - Health Routes: For monitoring and status checks

4. **Data Processors**
   - Base Processor: Abstract class defining common processor interface
   - Type-specific processors (BOE, DOGA): Handle specific subscription types

### Directory Structure

```
src/
├── config/               # Configuration modules
│   ├── database.js       # Database connection setup
│   ├── logger.js         # Logger configuration
│   ├── pubsub.js         # PubSub setup for notifications
│   └── secrets.js        # Secret management
│
├── routes/               # API route handlers
│   ├── api/              # Main API endpoints
│   │   ├── index.js      # API router setup
│   │   └── subscriptions/# Subscription-related endpoints
│   ├── legacy/           # Backward compatibility routes
│   └── health.js         # Health check endpoints
│
├── services/             # Business logic
│   ├── processors/       # Specific processor implementations
│   │   ├── base.js       # Base processor class
│   │   ├── boe.js        # BOE processor implementation
│   │   ├── doga.js       # DOGA processor implementation
│   │   └── registry.js   # Processor registry
│   │
│   └── subscription/     # Subscription handling
│       ├── database.js   # Subscription database operations
│       ├── index.js      # Main subscription processor
│       ├── notification.js # Notification creation
│       └── processing.js # Processing logic
│
├── types/                # Type definitions
│   └── schemas.js        # Zod schemas for validation
│
├── utils/                # Utility functions
│   ├── parser-protocol.js # Protocol for parser services
│   └── validation.js     # Input validation utilities
│
└── index.js              # Application entry point
```

## Request Flow

1. Client sends a request to process a subscription
   - Via `/api/subscriptions/process/:id` (recommended)
   - Or via legacy endpoint `/process-subscription/:id` (redirected)

2. Request is validated and a processing record is created

3. Processing happens asynchronously, with client receiving immediate 202 Accepted response

4. Subscription processor:
   - Retrieves subscription details from database
   - Identifies the appropriate processor type
   - Processes the subscription data
   - Creates notifications for matches
   - Updates processing status

5. Results are stored in database and can be queried later

## API Endpoints

### Main Endpoints

- `GET /api/health` - Check service health
- `POST /api/subscriptions/process/:id` - Process a subscription
- `GET /api/subscriptions/pending` - List pending subscriptions
- `POST /api/subscriptions/batch/process` - Process all pending subscriptions

### Legacy Endpoints (Redirect to Main API)

- `POST /process-subscription/:id` - Redirects to `/api/subscriptions/process/:id`

## Error Handling

The service implements consistent error handling:
- HTTP 4xx status codes for client errors
- HTTP 5xx status codes for server errors
- Standardized error response format
- Detailed logging for debugging
- Retry mechanisms for transient errors

## Configuration

The service is configured via environment variables:
- `NODE_ENV` - Environment (production, development)
- `PORT` - Server port (default: 8080)
- `PROJECT_ID` - Google Cloud project ID
- `PARSER_BASE_URL` - Base URL for parser services
- `LOG_LEVEL` - Logging level (info, debug, warn, error)

## Processor Types

The service supports multiple processor types:
- **BOE** - Spanish Official Bulletin processor
- **DOGA** - Galician Official Diary processor
- Additional processor types can be added by extending the base processor