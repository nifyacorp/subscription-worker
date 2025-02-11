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

### Services (`src/services/`)
- `processors/`: Content processing implementations
  - `base.js`: Abstract base processor with common functionality
  - `boe.js`: BOE-specific content processor
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
   - Request/response timing
   - Match statistics
   - Error details

3. Database Operations:
   - Connection pool metrics
   - Query execution times
   - Transaction status
   - Error handling

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
PARSER_BASE_URL=https://boe-parser-415554190254.us-central1.run.app
LOG_LEVEL=info
PROJECT_ID=your-project-id
```

## License

Proprietary - All rights reserved