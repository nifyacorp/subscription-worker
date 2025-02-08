# Subscription Processor Service

A Node.js microservice that processes BOE (Boletín Oficial del Estado) subscriptions using Cloud Run and Cloud SQL.

## Repository Structure

```
.
├── src/
│   ├── config/           # Configuration modules
│   │   ├── database.js   # Database connection and pool management
│   │   ├── logger.js     # Pino logger configuration
│   │   └── secrets.js    # Google Cloud Secret Manager integration
│   ├── controllers/      # Business logic controllers
│   │   └── boe-parser/   # BOE document parsing controller
│   ├── routes/          # Express route handlers
│   │   ├── health.js    # Health check endpoint
│   │   └── subscriptions.js # Subscription-related endpoints
│   ├── services/        # Core business services
│   │   └── subscriptionProcessor.js # Main subscription processing logic
│   └── index.js         # Application entry point
├── Dockerfile           # Container configuration
├── cloudbuild.yaml      # Cloud Build deployment configuration
├── scheduler.yaml       # Cloud Scheduler job configuration
└── package.json         # Project dependencies and scripts
```

## Component Overview

### Configuration (`src/config/`)
- `database.js`: Manages PostgreSQL connection pool with Cloud SQL
- `logger.js`: Configures structured logging with Pino
- `secrets.js`: Handles secure access to configuration via Secret Manager

### Controllers (`src/controllers/`)
- `boe-parser/`: Handles BOE document analysis and processing
  - Communicates with external parser service
  - Manages subscription state transitions
  - Processes analysis results

### Routes (`src/routes/`)
- `health.js`: System health monitoring endpoint
- `subscriptions.js`: API endpoints for subscription management
  - GET `/pending-subscriptions`: Lists pending subscriptions
  - POST `/process-subscriptions`: Triggers subscription processing

### Services (`src/services/`)
- `subscriptionProcessor.js`: Core business logic
  - Coordinates subscription processing
  - Manages database transactions
  - Handles error recovery and retries

## Service URL

The service is deployed and accessible at:
```
https://subscription-worker-415554190254.us-central1.run.app
```

## API Endpoints

### Health Check
```http
GET /_health
```
Returns the service and database health status.

### Get Pending Subscriptions
```http
GET /pending-subscriptions
```
Returns a list of pending BOE subscriptions that are ready for processing.

Response format:
```json
{
  "count": 2,
  "subscriptions": [
    {
      "subscription_id": "uuid",
      "status": "pending",
      "last_run_at": "2024-02-04T11:00:00Z",
      "next_run_at": "2024-02-04T11:05:00Z",
      "metadata": {
        "type": "boe",
        "id": "boe-general"
      },
      "error": null
    }
  ]
}
```

### Process Subscriptions
```http
POST /process-subscriptions
```
Triggers the processing of pending BOE subscriptions.

Response format:
```json
{
  "status": "success"
}
```

## Overview

This service processes subscriptions by:
1. Fetching pending subscriptions from a PostgreSQL database
2. Analyzing BOE content using an external parser service
3. Creating notifications based on the analysis results
4. Managing subscription states and scheduling

## Architecture

### Runtime Environment
- **Platform**: Google Cloud Run (serverless)
- **Base Image**: Node.js 18 (slim)
- **Database**: Cloud SQL (PostgreSQL)

### Database Connection

The service connects to Cloud SQL using the following configuration:

1. **Cloud Run Configuration**:
   - Set the `INSTANCE_CONNECTION_NAME` environment variable:
     ```
     INSTANCE_CONNECTION_NAME=project-id:region:instance-name
     ```
   - Attach the Cloud SQL instance to the Cloud Run service
   - Grant the service account the Cloud SQL Client role

2. **Database Credentials**:
   Store these in Secret Manager:
   - `DB_NAME`: Database name
   - `DB_USER`: Database user
   - `DB_PASSWORD`: Database password

3. **Connection Method**:
   - Uses Unix Domain Socket in `/cloudsql/INSTANCE_CONNECTION_NAME`
   - No Cloud SQL Auth Proxy needed - Cloud Run handles this automatically
   - Connection pooling with configurable limits

4. **Connection Pool Configuration**:
   ```javascript
   const config = {
     user: process.env.DB_USER,
     password: process.env.DB_PASSWORD,
     database: process.env.DB_NAME,
     host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
     max: 20,                           // Maximum pool size
     idleTimeoutMillis: 30000,         // Close idle connections after 30s
     connectionTimeoutMillis: 5000     // Connection timeout after 5s
   };
   ```

### Key Dependencies
- **Web Framework**: Express.js
- **Database**: node-postgres (pg)
- **Security**: 
  - Cloud Secret Manager
- **Logging**: Pino with structured JSON output
- **HTTP Client**: Axios for external API calls

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

### Project Setup

#### Cloud SQL Setup
1. Create a Cloud SQL instance in your project
2. Create a database and user
3. Store credentials in Secret Manager:
   ```bash
   gcloud secrets create DB_NAME --data-file=- <<< "your-db-name"
   gcloud secrets create DB_USER --data-file=- <<< "your-db-user"
   gcloud secrets create DB_PASSWORD --data-file=- <<< "your-db-password"
   ```
4. Grant Secret Manager access to your service account:
   ```bash
   gcloud projects add-iam-policy-binding PROJECT_ID \
     --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
     --role="roles/secretmanager.secretAccessor"
   ```

#### Local Development
```bash
git clone <repository-url>
cd subscription-processor
```

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

### Logging
- Structured JSON logs via Pino
- Log levels configurable via LOG_LEVEL env var
- Detailed error tracking with stack traces

### Health Monitoring
- HTTP health check endpoint at `/_health`
- Database connectivity validation
- Cloud Run health checks integration

### Error Tracking
- Comprehensive error capture
- Detailed error context in logs
- Automatic error recovery where possible

## Security

### Database Security
- Cloud SQL Auth Proxy for encrypted connections
- Connection pooling with configurable limits
- Row-level security in PostgreSQL tables

### Configuration Security
- Sensitive data stored in Secret Manager
- Environment-specific configurations
- Secure secret rotation support

### API Security
- HTTPS-only endpoints
- Cloud Run authentication (optional)
- Rate limiting on API endpoints

## Contributing

1. Follow the existing code structure
2. Add comprehensive logging
3. Include error handling
4. Update documentation as needed
5. Test thoroughly before submitting changes

## License

Proprietary - All rights reserved