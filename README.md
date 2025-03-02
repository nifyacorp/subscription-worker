# Subscription Processor Service

## Overview
The Subscription Processor is a Node.js microservice responsible for processing user subscriptions, matching them against various data sources (primarily BOE documents), and generating notifications. It runs on Google Cloud Run, uses Cloud SQL for data storage, and integrates with PubSub for message-based communication with other services.

The service now includes functionality to dispatch notifications to the email notification system based on user preferences, allowing for both immediate and daily digest emails.

## Repository Structure

```
subscription-worker/
├── .bolt/                  # Bolt runtime configuration
├── src/                    # Source code
│   ├── config/             # Configuration files
│   │   ├── database.js     # Database connection setup
│   │   ├── logger.js       # Pino logger configuration
│   │   ├── pubsub.js       # PubSub client and topic management
│   │   └── secrets.js      # Secret management for credentials
│   ├── routes/             # API routes
│   │   └── subscriptions/  # Subscription-related endpoints
│   │       └── index.js    # Route handlers for subscriptions
│   ├── services/           # Business logic services
│   │   ├── processors/     # Data source processors
│   │   │   ├── base.js     # Base processor class
│   │   │   ├── boe.js      # BOE-specific processor
│   │   │   └── registry.js # Processor type registry
│   │   ├── subscription/   # Subscription handling
│   │   │   ├── database.js # Database operations for subscriptions
│   │   │   ├── index.js    # Main subscription processing logic
│   │   │   ├── notification.js # Notification creation and publishing
│   │   │   └── processing.js   # Subscription processing utilities
│   │   └── subscriptionProcessor.js # Main processor service
│   └── index.js            # Service entry point
├── Dockerfile              # Container configuration
├── package.json            # Dependencies and scripts
└── README.md               # This documentation
```

## Component Overview

The service consists of these key components:

1. **Subscription Processor**: Manages the processing of user subscriptions, delegating to the appropriate data source processor.

2. **BOE Processor**: Processes BOE-related subscriptions by querying the BOE Analyzer API and handling the results.

3. **Notification Service**: Creates notifications in the database and publishes them to the notification and email topics.

4. **PubSub Integration**: Manages message publishing to the notification-worker and email-notification services.

5. **Database Service**: Handles all database operations related to subscriptions and notifications.

## Service URLs

- **Production**: https://subscription-processor-[PROJECT_ID].a.run.app
- **Development**: http://localhost:8080

## Email Notification Integration

The subscription-worker now integrates with the email notification system through:

1. **User Preference Checking**: Before sending email notifications, the system checks if the user has enabled email notifications and their preferred frequency (immediate or daily digest).

2. **PubSub Publishing**: Notifications are published to dedicated PubSub topics:
   - `email-notifications-immediate`: For notifications that should be sent immediately
   - `email-notifications-daily`: For notifications that will be included in daily digest emails

3. **Debug Mode**: For the test user (nifyacorp@gmail.com), immediate notifications are always enabled for debugging purposes, regardless of their preferences.

## API Endpoints

### Health Check
- **URL**: `/health`
- **Method**: `GET`
- **Description**: Returns service health status
- **Response**: `{"status": "ok", "time": "2023-01-01T00:00:00.000Z"}`

### Get Pending Subscriptions
- **URL**: `/api/v1/subscriptions/pending`
- **Method**: `GET`
- **Description**: Retrieves subscriptions pending processing
- **Query Parameters**:
  - `limit` (optional): Maximum number of subscriptions to return
  - `type` (optional): Filter by subscription type
- **Response**:
```json
{
  "subscriptions": [
    {
      "subscription_id": "123e4567-e89b-12d3-a456-426614174000",
      "user_id": "user_123",
      "type": "boe",
      "prompts": ["prompt1", "prompt2"],
      "created_at": "2023-01-01T00:00:00.000Z"
    }
  ],
  "count": 1
}
```

### Process Subscription
- **URL**: `/api/v1/subscriptions/:id/process`
- **Method**: `POST`
- **Description**: Manually triggers processing for a specific subscription
- **Path Parameters**:
  - `id`: Subscription ID
- **Response**:
```json
{
  "status": "success",
  "subscription_id": "123e4567-e89b-12d3-a456-426614174000",
  "matches": 5,
  "processing_time_ms": 1200
}
```

### Debug BOE Analysis
- **URL**: `/api/v1/debug/boe`
- **Method**: `POST`
- **Description**: Debug endpoint for testing BOE analysis
- **Request Body**:
```json
{
  "prompt": "Example prompt text",
  "documents": [
    {
      "title": "Sample BOE Document",
      "content": "Sample content...",
      "publication_date": "2023-01-01"
    }
  ]
}
```
- **Response**:
```json
{
  "status": "success",
  "matches": [
    {
      "title": "Sample BOE Document",
      "relevance_score": 0.85,
      "summary": "AI-generated summary...",
      "publication_date": "2023-01-01"
    }
  ],
  "processing_time_ms": 800
}
```

## Debugging & Monitoring

The service logs all operations in JSON format for easy ingestion by monitoring tools:

1. **Subscription Processing**:
   - Subscription request received
   - Processor type selected
   - Processing results
   - Error conditions

2. **BOE Processing**:
   - API requests to BOE Analyzer
   - Response status and timing
   - Match count and sample data

3. **Database Operations**:
   - Query execution
   - Row counts
   - Error conditions

4. **PubSub Operations**:
   - Message publication to notification topics
   - Message publication to email notification topics (immediate and daily)
   - Error handling and dead-letter queues

5. **Email Notification**:
   - User preference checks
   - Publication attempts to email topics
   - Success/failure status

## Environment Variables

### Required
- `PROJECT_ID`: Google Cloud project ID
- `PORT`: Server port (default: 8080)
- `DB_CONNECTION_NAME`: Cloud SQL connection name (format: project:region:instance)
- `DB_SOCKET_PATH`: Unix socket path for Cloud SQL Proxy connection

### Optional
- `NODE_ENV`: Environment mode (development/production)
- `LOG_LEVEL`: Logging level (default: info)
- `DB_NAME`: Database name (default from secrets)
- `DB_USER`: Database user (default from secrets)
- `DB_PASSWORD`: Database password (default from secrets)
- `BOE_API_URL`: URL for BOE Analyzer API
- `BOE_API_KEY`: API key for BOE Analyzer
- `MOCK_DB`: Enable mock database mode (for development)
- `PUBSUB_TOPIC_NAME`: Topic for notification messages
- `PUBSUB_DLQ_TOPIC_NAME`: Dead-letter queue topic

## Testing

### Local Testing
1. Set environment variables in `.env` file
2. Run `npm run dev` for development mode with hot reloading
3. Use Postman or curl to test API endpoints

### Unit Tests
Run `npm test` to execute the test suite, which covers:
- Subscription processing logic
- BOE processor functionality
- Notification creation and delivery
- Email notification integration

### Integration Tests
Run `npm run test:integration` to test with actual cloud services (requires GCP credentials)

## Deployment

The service is deployed to Google Cloud Run using Cloud Build:

```bash
gcloud builds submit --tag gcr.io/[PROJECT_ID]/subscription-processor
gcloud run deploy subscription-processor --image gcr.io/[PROJECT_ID]/subscription-processor --platform managed
```

## Email Notification Configuration

To properly configure email notification integration:

1. Ensure the following secrets are available in Secret Manager:
   - `EMAIL_IMMEDIATE_TOPIC_NAME`: PubSub topic for immediate notifications
   - `EMAIL_DAILY_TOPIC_NAME`: PubSub topic for daily digest notifications

2. For local development, set these values in your environment variables