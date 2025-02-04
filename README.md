# Subscription Processor Service

A Node.js microservice that processes BOE (Boletín Oficial del Estado) subscriptions using Cloud Run and Cloud SQL.

## Overview

This service processes subscriptions by:
1. Fetching pending subscriptions from a PostgreSQL database
2. Analyzing BOE content using an external parser service
3. Creating notifications based on the analysis results
4. Managing subscription states and scheduling

## Architecture

- **Runtime**: Node.js 18 on Cloud Run
- **Database**: PostgreSQL on Cloud SQL
- **Dependencies**:
  - Express.js for HTTP server
  - node-postgres for database connectivity
  - Cloud SQL Auth Proxy for secure database connections
  - Pino for structured logging
  - Cloud Secret Manager for secure configuration

## Key Components

- `src/index.js`: Application entry point and server setup
- `src/config/`: Configuration modules for database, logging, and secrets
- `src/controllers/`: Business logic controllers (BOE parser)
- `src/routes/`: Express route handlers
- `src/services/`: Core business services

## Database Schema

### Tables

- `subscription_processing`: Manages subscription states and scheduling
  - `subscription_id`: Unique identifier
  - `status`: Current status (pending/processing/completed/failed)
  - `last_run_at`: Last execution timestamp
  - `next_run_at`: Next scheduled execution
  - `metadata`: JSON field with subscription details
  - `error`: Error message if failed

- `notifications`: Stores processing results
  - `subscription_id`: Reference to subscription
  - `content`: JSON content of processing results
  - `created_at`: Creation timestamp

## Environment Variables

```env
PARSER_BASE_URL=https://your-parser-service-url
LOG_LEVEL=info
PROJECT_ID=your-project-id
```

## Cloud Run Configuration

The service is deployed to Cloud Run with:
- Memory: Default
- CPU: Default
- Concurrency: Default
- HTTP/2: Enabled
- Startup probe: TCP on port 8080

## Deployment

Deployment is handled through Cloud Build using:
- `cloudbuild.yaml`: Main service deployment
- `scheduler.yaml`: Cloud Scheduler job setup

### Deploy Steps

1. Build Docker image
2. Push to Container Registry
3. Deploy to Cloud Run
4. Set up Cloud Scheduler (optional)

```bash
gcloud builds submit --config=cloudbuild.yaml
gcloud builds submit --config=scheduler.yaml  # Optional: For scheduler setup
```

## Development

### Prerequisites

- Node.js 18+
- PostgreSQL
- Google Cloud SDK

### Local Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your values
```

3. Start development server:
```bash
npm run dev
```

### Testing

The service includes a health check endpoint:
```bash
curl http://localhost:8080/_health
```

## Monitoring

- **Logging**: Structured JSON logs using Pino
- **Health Checks**: HTTP endpoint at `/_health`
- **Error Handling**: Comprehensive error capture and reporting

## Security

- Cloud SQL Auth Proxy for secure database connections
- Secret Manager for sensitive configuration
- Row-level security in PostgreSQL
- HTTPS-only endpoints

## Contributing

1. Follow the existing code structure
2. Add comprehensive logging
3. Include error handling
4. Update documentation as needed
5. Test thoroughly before submitting changes

## License

Proprietary - All rights reserved