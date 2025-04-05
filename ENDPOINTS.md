# Subscription Worker API Endpoints

This document provides details about the endpoints available in the Subscription Worker service, which coordinates the subscription processing flow in NIFYA.

**Base URL**: `https://subscription-worker-415554190254.us-central1.run.app`

## Authorization

Some endpoints require API key authentication:

```
X-API-Key: {api_key}
```

## Health Check Endpoints

### Check Service Health

- **URL**: `/health` or `/api/health` or `/_health` or `/api/_health`
- **Method**: `GET`
- **Authentication**: None
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "status": "healthy",
    "database": "connected"
  }
  ```
- **Error Response**:
  - **Code**: 500
  - **Content**:
  ```json
  {
    "status": "unhealthy",
    "database": "disconnected",
    "error": "Error details if available"
  }
  ```
- **Role in Flow**: Used by monitoring systems to check service health.

## Subscription Processing Endpoints

### Process a Subscription

- **URL**: `/api/subscriptions/process/:id`
- **Method**: `POST`
- **Authentication**: Required (API Key)
- **URL Parameters**:
  - `id`: The ID of the subscription to process
- **Success Response**:
  - **Code**: 202 (Accepted)
  - **Content**:
  ```json
  {
    "status": "success",
    "message": "Subscription queued for processing",
    "processing_id": "UUID",
    "subscription_id": "UUID"
  }
  ```
- **Error Responses**:
  - **Code**: 400 BAD REQUEST
  - **Content**:
  ```json
  {
    "status": "error",
    "error": "Invalid subscription ID",
    "message": "A valid subscription ID is required"
  }
  ```
  - **Code**: 500 INTERNAL SERVER ERROR
  - **Content**:
  ```json
  {
    "status": "error",
    "error": "Error in subscription processor",
    "message": "Detailed error message"
  }
  ```
  - **Code**: 503 SERVICE UNAVAILABLE
  - **Content**:
  ```json
  {
    "status": "error",
    "error": "Database unavailable",
    "message": "The service is currently running with a mock database. Please ensure PostgreSQL is running and accessible."
  }
  ```
- **Role in Flow**: This endpoint is called by the Backend service to process a subscription. Processing happens asynchronously.

### List Pending Subscriptions

- **URL**: `/api/subscriptions/pending`
- **Method**: `GET`
- **Authentication**: Required (API Key)
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "subscriptions": [
      {
        "processing_id": "UUID",
        "subscription_id": "UUID",
        "status": "pending",
        "next_run_at": "2023-01-01T00:00:00Z",
        "user_id": "UUID",
        "type_name": "BOE",
        "prompts": ["prompt1", "prompt2"]
      }
    ],
    "count": 1
  }
  ```
- **Error Response**:
  - **Code**: 500
  - **Content**:
  ```json
  {
    "status": "error",
    "error": "Failed to fetch pending subscription actions",
    "message": "Detailed error message"
  }
  ```
- **Role in Flow**: Used to retrieve subscriptions that are pending processing.

### Batch Process Subscriptions

- **URL**: `/api/subscriptions/batch/process`
- **Method**: `POST`
- **Authentication**: Required (API Key)
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "status": "success",
    "processed": 5,
    "success_count": 4,
    "error_count": 1,
    "subscriptions": [
      {
        "subscription_id": "UUID1",
        "processing_id": "UUID1",
        "status": "success"
      },
      {
        "subscription_id": "UUID2",
        "processing_id": "UUID2",
        "status": "error",
        "error": "Error details"
      }
    ]
  }
  ```
- **Error Response**:
  - **Code**: 500
  - **Content**:
  ```json
  {
    "status": "error",
    "error": "Error in batch subscription processing",
    "message": "Detailed error message"
  }
  ```
- **Role in Flow**: Used for batch processing of pending subscriptions, typically by scheduled jobs.

## Legacy Endpoints

These endpoints are maintained for backward compatibility and redirect to the modern API endpoints.

### Process a Subscription (Legacy)

- **URL**: `/process-subscription/:id`
- **Method**: `POST`
- **Authentication**: Required (API Key)
- **URL Parameters**:
  - `id`: The ID of the subscription to process
- **Behavior**: Redirects to `/api/subscriptions/process/:id` with the same parameters and headers.
- **Role in Flow**: Maintained for backward compatibility with existing integrations.

## BOE-Specific Endpoints

### Process BOE Subscription

- **URL**: `/api/boe/process`
- **Method**: `POST`
- **Authentication**: Required (API Key)
- **Request Body**:
  ```json
  {
    "prompts": ["search term 1", "search term 2"],
    "user_id": "UUID",
    "subscription_id": "UUID",
    "options": {
      "limit": 10,
      "date": "2025-04-04"
    }
  }
  ```
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "status": "success",
    "entries": [
      {
        "document_type": "Anuncio",
        "title": "Document title",
        "summary": "Document summary",
        "relevance_score": 0.85,
        "prompt": "search term 1",
        "links": {
          "html": "https://example.com/document",
          "pdf": "https://example.com/document.pdf"
        }
      }
    ]
  }
  ```
- **Error Response**:
  - **Code**: 400/500
  - **Content**:
  ```json
  {
    "status": "error",
    "error": "Error type",
    "message": "Detailed error message"
  }
  ```
- **Role in Flow**: Directly processes a BOE subscription by communicating with the BOE Parser.

## Debug Endpoints (Non-Production Only)

The following endpoints are only available in non-production environments or when `ENABLE_DEBUG_ROUTES=true`:

### Debug API Documentation

- **URL**: `/api/debug`
- **Method**: `GET`
- **Authentication**: Required (API Key)
- **Description**: Returns available debug endpoints and documentation
- **Success Response**:
  - **Code**: 200
  - **Content**: Detailed documentation about all available debug endpoints

### Service Status

- **URL**: `/api/debug/status`
- **Method**: `GET`
- **Authentication**: Required (API Key)
- **Description**: Returns detailed service status information
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "status": "success",
    "timestamp": "2023-01-01T00:00:00.000Z",
    "response_time_ms": 5,
    "service": {
      "version": "1.0.0",
      "uptime": 3600,
      "node_env": "development",
      "memory_usage": { 
        "rss": 60000000, 
        "heapTotal": 40000000, 
        "heapUsed": 30000000 
      }
    },
    "database": {
      "connected": true,
      "query_latency_ms": 5,
      "pool_total": 5,
      "pool_idle": 5,
      "pool_waiting": 0
    },
    "processors": {
      "available": ["boe", "doga"],
      "boe": {
        "status": "initialized",
        "type": "BOEProcessor",
        "has_process_method": true
      },
      "doga": {
        "status": "initialized",
        "type": "DOGAProcessor",
        "has_process_method": true
      }
    }
  }
  ```

### Test Processor

- **URL**: `/api/debug/test-processor/:type`
- **Method**: `POST`
- **Authentication**: Required (API Key)
- **URL Parameters**:
  - `type`: The processor type to test (e.g., "boe", "doga")
- **Request Body**:
  ```json
  {
    "prompts": ["search term 1", "search term 2"],
    "options": {
      "limit": 5,
      "date": "2023-01-01"
    }
  }
  ```
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "status": "success",
    "processor": "boe",
    "processing_time_ms": 1234,
    "result": {
      "status": "success",
      "matches": [
        {
          "title": "Document title",
          "summary": "Document summary",
          "relevance_score": 0.85
        }
      ],
      "test_metadata": {
        "processing_time_ms": 1234,
        "processor_type": "boe",
        "processor_constructor": "BOEProcessor",
        "test_timestamp": "2023-01-01T00:00:00.000Z"
      }
    }
  }
  ```

### Test Database Connection

- **URL**: `/api/debug/test-db`
- **Method**: `GET`
- **Authentication**: Required (API Key)
- **Description**: Tests database connection and returns schema information
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "status": "success",
    "connection": {
      "successful": true,
      "latency_ms": 5,
      "pool_stats": {
        "total": 5,
        "idle": 5,
        "waiting": 0
      }
    },
    "schema": {
      "tables": ["subscriptions", "notifications", "subscription_processing"]
    },
    "database_stats": {
      "subscription_count": 10,
      "notification_count": 50,
      "processing_count": 15
    }
  }
  ```

### Get Recent Logs

- **URL**: `/api/debug/logs`
- **Method**: `GET`
- **Authentication**: Required (API Key)
- **Query Parameters**:
  - `limit`: Number of logs to return (default: 100)
  - `level`: Filter by log level (info, error, warn, debug)
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "status": "success",
    "message": "This is a simulated log endpoint. In production, connect to your actual logging service.",
    "logs": [
      {
        "timestamp": "2023-01-01T00:00:00.000Z",
        "level": "info",
        "message": "Debug logs endpoint accessed"
      }
    ],
    "count": 1,
    "query": {
      "limit": 100,
      "level": "info"
    }
  }
  ```

## Error Responses

Common error response format:

```json
{
  "status": "error",
  "error": "Error type",
  "message": "Detailed error message"
}
```

Common status codes:
- **400 Bad Request**: Invalid input parameters
- **401 Unauthorized**: Missing or invalid API key
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server-side error
- **503 Service Unavailable**: Service temporarily unavailable (e.g., database down)