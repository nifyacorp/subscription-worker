# Subscription Processor Service

A Node.js microservice that processes BOE (Boletín Oficial del Estado) subscriptions using Cloud Run and Cloud SQL.

## Repository Structure.

```
.
├── src/
│   ├── config/           # Configuration modules
│   │   ├── database.js   # Database connection and pool management
│   │   ├── logger.js     # Pino logger configuration
│   │   ├── pubsub.js     # Google Cloud Pub/Sub configuration
│   │   └── secrets.js    # Google Cloud Secret Manager integration
│   ├── controllers/      # Business logic controllers
│   │   └── boe-parser/   # BOE document parsing controller
│   ├── routes/          # Express route handlers
│   │   ├── health.js    # Health check endpoint
│   │   └── subscriptions.js # Subscription-related endpoints
│   ├── services/        # Core business services
│   │   ├── processors/  # Content processors
│   │   │   ├── base.js  # Base processor class
│   │   │   ├── boe.js   # BOE-specific processor
│   │   │   └── registry.js # Processor type registry
│   │   └── subscriptionProcessor.js # Main subscription processing logic
│   └── index.js         # Application entry point
├── Dockerfile           # Container configuration
├── cloudbuild.yaml      # Cloud Build deployment configuration
└── scheduler.yaml       # Cloud Scheduler job configuration
```

## Component Overview

### Configuration (`src/config/`)
- `database.js`: Manages PostgreSQL connection pool with Cloud SQL
- `logger.js`: Configures structured logging with Pino
- `secrets.js`: Handles secure access to configuration via Secret Manager
- `pubsub.js`: Manages PubSub topic connections and message publishing

### Services (`src/services/`)
- `processors/`: Content processing implementations
  - `base.js`: Abstract base processor with common functionality
  - `boe.js`: BOE-specific content processor with retry capabilities
  - `registry.js`: Registry for managing processor types
- `subscriptionProcessor.js`: Core business logic
  - Coordinates subscription processing
  - Manages database transactions
  - Handles error recovery and retries
  - Detailed debug logging for each processing step

## Service URLs

- Main Service: `https://subscription-worker-415554190254.us-central1.run.app`
- BOE Parser: `https://boe-parser-415554190254.us-central1.run.app`

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
Returns a list of all active subscriptions that are ready for processing.

Response format:
```json
{
   "count": 2,
   "subscriptions": [
     {
       "processing_id": "uuid",
       "subscription_id": "uuid",
       "metadata": {},
       "user_id": "uuid",
       "type_id": "boe",
       "prompts": ["query1", "query2"],
       "frequency": "daily",
       "last_check_at": "2024-02-04T11:00:00Z"
     }
   ]
}
```

### Process Single Subscription
```http
POST /process-subscription/:id
```
Processes a specific subscription by ID. The endpoint will:
1. Lock the subscription for processing
2. Update its status to 'processing'
3. Process content based on subscription type
4. Create notifications for matches
5. Update processing status and schedule next run

Response format:
```json
{
  "status": "success",
  "subscription_id": "uuid",
  "matches_found": 2
}
```

### Process Subscriptions
```http
POST /process-subscriptions
```
Triggers the processing of all pending subscriptions.

Response format:
```json
{
  "status": "success",
  "processed": 2,
  "results": [
    {
      "subscription_id": "uuid",
      "status": "success",
      "matches_found": 1
    }
  ]
}
```

### Debug BOE Analysis
```http
POST /boe/debug/analyze-boe
Content-Type: application/json

{
  "prompts": [
    "Find all resolutions about public employment",
    "List announcements about environmental grants"
  ]
}
```
Test endpoint for direct BOE content analysis.

## Debugging and Monitoring

The service includes comprehensive debug logging for each processing step:

1. Subscription Processing:
   - Pool status and connection metrics
   - Query execution times
   - Processing status updates
   - Content analysis timing
   - Notification creation metrics

2. BOE Processing:
   - Service URL configuration
   - Request/response timing and retries
   - Match statistics
   - Error details
   - Timeout and retry attempt logging

3. Database Operations:
   - Connection pool metrics
   - Query execution times
   - Transaction status
   - Error handling

4. PubSub Operations:
   - Message formatting
   - Publishing status
   - Error handling with DLQ support
   - Retry logic for failed publishes

All logs are structured JSON format with:
- Timestamps
- Operation context
- Performance metrics
- Error details when applicable

## Testing

Use curl to test the endpoints:

```bash
# Health check
curl http://localhost:8080/_health

# Get pending subscriptions
curl http://localhost:8080/pending-subscriptions

# Process all subscriptions
curl -X POST http://localhost:8080/process-subscriptions

# Process specific subscription
curl -X POST http://localhost:8080/process-subscription/YOUR_SUBSCRIPTION_ID

# Test BOE analysis
curl -X POST http://localhost:8080/boe/debug/analyze-boe \
  -H "Content-Type: application/json" \
  -d '{
    "prompts": [
      "Find all resolutions about public employment",
      "List announcements about environmental grants"
    ]
  }'
```

## Environment Variables

```env
# Database Configuration
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=

# Google Cloud Configuration
PROJECT_ID=your-project-id
GCP_KEY_FILE= (optional for local development)

# Content Parser Configuration
PARSER_API_KEY=
BOE_API_URL=

# PubSub Configuration
PUBSUB_TOPIC_NAME=processor-results
PUBSUB_SUBSCRIPTION_NAME=notifications-worker
PUBSUB_DLQ_TOPIC_NAME=processor-results-dlq

# Server Configuration
LOG_LEVEL=info
PORT=8080
NODE_ENV=production
```

## Recent Architectural Changes

### 1. Notification Publishing Responsibility

This service has been updated to take over notification publishing responsibilities from the content parser services. The new workflow is:

1. Subscription Worker receives a subscription processing request
2. It retrieves the subscription details from the database
3. It sends the prompts to the appropriate content parser (e.g., BOE Parser)
4. The content parser analyzes and returns matches (NOT publishing to PubSub)
5. The Subscription Worker formats the matches and publishes them to PubSub
6. The Notification Worker processes these messages and creates user notifications

This change improves separation of concerns:
- Content parsers focus solely on content analysis
- Subscription Worker orchestrates the entire process
- Notification Worker handles notification creation and delivery

### 2. Resilient BOE Parser Integration

We've improved the reliability of communication with the BOE Parser service:

- **Retry Mechanism**: Implements exponential backoff retries for transient errors
- **Dynamic Timeouts**: Increases timeout duration for successive retry attempts
- **Error Classification**: Distinguishes between retryable and non-retryable errors
- **Detailed Logging**: Captures complete information about retry attempts

These changes ensure that temporary issues with the BOE Parser don't cause subscription processing to fail completely.

### 3. Enhanced PubSub Integration

The PubSub configuration has been updated to:

- Use environment variables for topic names (`PUBSUB_TOPIC_NAME`, `PUBSUB_DLQ_TOPIC_NAME`)
- Support Dead Letter Queue (DLQ) for failed message publishing
- Provide detailed error information in DLQ messages
- Add comprehensive logging for message publishing attempts

## How It Works

The main component is the `SubscriptionProcessor` class which:
1. Connects to the PostgreSQL database
2. Retrieves subscription details
3. Determines which content parser to use based on the subscription type
4. Calls the appropriate parser service via HTTP (with retry logic)
5. Formats and publishes notification messages to PubSub (with DLQ support)
6. Updates the subscription processing status in the database

## Configuration

The service requires the following environment variables:

```
# Database Configuration
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=

# Google Cloud Configuration
PROJECT_ID=
GCP_KEY_FILE= (optional for local development)

# Content Parser Configuration
PARSER_API_KEY=
BOE_API_URL=

# PubSub Configuration
PUBSUB_TOPIC_NAME=processor-results
PUBSUB_SUBSCRIPTION_NAME=notifications-worker
PUBSUB_DLQ_TOPIC_NAME=processor-results-dlq

# Other Configuration
PORT=8080
NODE_ENV=production
LOG_LEVEL=info
```

## Local Development

1. Install dependencies:
```
npm install
```

2. Create a `.env` file with the required environment variables

3. Start the service:
```
npm run dev
```

## Deployment

The service is deployed to Google Cloud Run:

```
gcloud builds submit --tag gcr.io/[PROJECT_ID]/subscription-worker

gcloud run deploy subscription-worker \
  --image gcr.io/[PROJECT_ID]/subscription-worker \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="PUBSUB_TOPIC_NAME=processor-results,PUBSUB_SUBSCRIPTION_NAME=notifications-worker,PUBSUB_DLQ_TOPIC_NAME=processor-results-dlq"
```

## Dependencies

- Express - Web framework
- pg - PostgreSQL client
- @google-cloud/pubsub - Google Cloud Pub/Sub client
- pino - Logging
- axios - HTTP client for calling parser services