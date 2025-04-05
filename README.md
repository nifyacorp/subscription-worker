# Subscription Worker Service

## Overview

The Subscription Worker is a microservice responsible for processing user subscriptions to various data sources (primarily BOE and DOGA documents), matching them against criteria, and generating notifications when matches are found. It runs on Google Cloud Run, uses PostgreSQL for data storage, and integrates with PubSub for notification delivery.

## Features

- Process subscriptions of various types (BOE, DOGA)
- Asynchronous processing with immediate response
- Batch processing of pending subscriptions
- Notification creation for matches with customizable delivery preferences
- Comprehensive health checks and monitoring endpoints
- Developer-friendly error responses with helpful guidance

## API Endpoints

### Core Endpoints

- `GET /api/health` - Check service health
- `POST /api/subscriptions/process/:id` - Process a subscription
- `GET /api/subscriptions/pending` - List pending subscriptions
- `POST /api/subscriptions/batch/process` - Process all pending subscriptions
- `POST /api/boe/process` - Process BOE-specific subscription

For detailed API documentation, see [ENDPOINTS.md](ENDPOINTS.md).

## Architecture

The service follows a clean, modular architecture:

- **API Layer**: Express routes for handling HTTP requests
- **Service Layer**: Business logic for processing subscriptions
- **Data Layer**: PostgreSQL database access
- **Processor Layer**: Type-specific implementations (BOE, DOGA)

For a detailed architecture overview, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup & Development

### Prerequisites

- Node.js 16+
- PostgreSQL 13+
- Google Cloud SDK (for production deployment)

### Environment Variables

```
NODE_ENV=development
PORT=8080
LOG_LEVEL=debug
PROJECT_ID=your-project-id
PARSER_BASE_URL=https://boe-parser-service-url
```

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run the service in development mode
npm run dev
```

## Debugging

The service includes comprehensive debug endpoints when running in development mode:

```bash
# Get service status
curl http://localhost:8080/api/debug/status

# Test a processor
curl -X POST http://localhost:8080/api/debug/test-processor/boe -d '{"prompts":["test"]}'

# Test database connection
curl http://localhost:8080/api/debug/test-db
```

## Deployment

The service is deployed to Google Cloud Run:

```bash
# Build and deploy using Cloud Build
gcloud builds submit --tag gcr.io/PROJECT_ID/subscription-worker
gcloud run deploy subscription-worker --image gcr.io/PROJECT_ID/subscription-worker --platform managed
```

## Error Handling

The service provides helpful error messages with guidance on proper API usage:

```json
{
  "status": "error",
  "error": "Invalid subscription ID",
  "message": "The provided subscription ID is not a valid UUID",
  "usage": {
    "description": "Process a subscription",
    "method": "POST",
    "path": "/api/subscriptions/process/:id",
    "example": "/api/subscriptions/process/123e4567-e89b-12d3-a456-426614174000"
  }
}
```

## Testing

```bash
# Test BOE parser integration
node test-boe-parser.js

# Test DOGA parser
curl -X POST http://localhost:8080/api/debug/test-processor/doga -d '{"prompts":["test"]}'
```

## Configuration

The service is configured via environment variables and Google Secret Manager. See `.env.example` for available configuration options.

## Repository Structure

```
├── src/                    # Source code
│   ├── config/             # Configuration modules
│   ├── middleware/         # Express middleware
│   ├── routes/             # API route handlers
│   │   ├── api/            # API endpoints
│   │   ├── legacy/         # Backward compatibility routes
│   │   └── health.js       # Health check endpoints
│   ├── services/           # Business logic services
│   │   ├── processors/     # Data source processors
│   │   └── subscription/   # Subscription handling
│   └── index.js            # Application entry point
├── scripts/                # Utility scripts
├── docs/                   # Documentation
└── README.md               # This documentation
```

## Contributing

To contribute to this project, please follow the [code style guidelines](CLAUDE.md) and ensure all tests pass before submitting a pull request.