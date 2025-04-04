# Subscription Worker API Endpoints

This document provides details about the endpoints available in the Subscription Worker service, which coordinates the subscription processing flow in NIFYA.

**Base URL**: `https://subscription-worker-415554190254.us-central1.run.app`

## Authorization

Some endpoints require API key authentication:

```
X-API-Key: {api_key}
```

## Subscription Processing Endpoints

### Process a Subscription

Processes a specific subscription, routing it to the appropriate parser based on its type.

- **URL**: `/process-subscription`
- **Method**: `POST`
- **Authentication**: Required (API Key)
- **Request Body**:
  ```json
  {
    "subscription_id": "UUID",
    "user_id": "UUID",
    "trace_id": "UUID",  // Optional
    "force": false       // Optional
  }
  ```
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "status": "success",
    "message": "Subscription processing started",
    "subscription_id": "UUID",
    "job_id": "UUID",
    "type": "boe",
    "parser_destination": "https://boe-parser-415554190254.us-central1.run.app"
  }
  ```
- **Error Response**:
  - **Code**: 404 NOT FOUND
  - **Content**:
  ```json
  {
    "status": "error",
    "error": "Subscription not found",
    "message": "The specified subscription ID does not exist"
  }
  ```
  - **Code**: 400 BAD REQUEST
  - **Content**:
  ```json
  {
    "status": "error",
    "error": "Invalid subscription type",
    "message": "No parser available for subscription type"
  }
  ```
- **Role in Flow**: This endpoint is called by the Backend service to forward subscription processing to the appropriate parser.

### Process Multiple Subscriptions

Processes multiple subscriptions in bulk.

- **URL**: `/process-subscriptions`
- **Method**: `POST`
- **Authentication**: Required (API Key)
- **Request Body**:
  ```json
  {
    "subscriptions": [
      {
        "subscription_id": "UUID1",
        "user_id": "UUID1"
      },
      {
        "subscription_id": "UUID2",
        "user_id": "UUID2"
      }
    ],
    "trace_id": "UUID"  // Optional
  }
  ```
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "status": "success",
    "message": "Bulk processing started",
    "job_count": 2,
    "successful": 2,
    "failed": 0,
    "jobs": [
      {
        "subscription_id": "UUID1",
        "status": "processing",
        "job_id": "UUID"
      },
      {
        "subscription_id": "UUID2",
        "status": "processing",
        "job_id": "UUID"
      }
    ]
  }
  ```
- **Role in Flow**: Used for batch processing of subscriptions, typically by scheduled jobs.

## BOE-Specific Endpoints

### Process BOE Subscription

Specialized endpoint for processing BOE subscriptions.

- **URL**: `/boe/process`
- **Method**: `POST`
- **Authentication**: Required (API Key)
- **Request Body**:
  ```json
  {
    "subscription_id": "UUID",
    "user_id": "UUID",
    "date": "2025-04-04",  // Optional, defaults to current date
    "texts": ["search term 1", "search term 2"]
  }
  ```
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "status": "success",
    "message": "BOE processing started",
    "job_id": "UUID",
    "parser_response": {
      "query_date": "2025-04-04",
      "results": [
        {
          "prompt": "search term 1",
          "matches": []
        }
      ]
    }
  }
  ```
- **Role in Flow**: Directly processes a BOE subscription by communicating with the BOE Parser.

## Health and Diagnostics

### Health Check

Basic health check endpoint.

- **URL**: `/health`
- **Method**: `GET`
- **Authentication**: None
- **Success Response**:
  - **Code**: 200
  - **Content**:
  ```json
  {
    "status": "healthy",
    "version": "1.0.0",
    "database": {
      "connected": true,
      "latency_ms": 5
    },
    "processors": {
      "boe": "available"
    }
  }
  ```
- **Role in Flow**: Used by monitoring systems to check service health.

### Debug Endpoints

Only available in non-production environments:

- **URL**: `/debug/parser-test`
- **Method**: `POST`
- **Authentication**: Required (API Key)
- **Request Body**:
  ```json
  {
    "parser": "boe",
    "text": "Test search term",
    "date": "2025-04-04"  // Optional
  }
  ```
- **Success Response**:
  - **Code**: 200
  - **Content**: Detailed parser response for debugging

## Error Responses

Common error responses:

- **Code**: 401 UNAUTHORIZED
  - **Content**: `{ "status": "error", "error": "Unauthorized", "message": "API key is missing or invalid" }`

- **Code**: 500 INTERNAL SERVER ERROR
  - **Content**: `{ "status": "error", "error": "Internal server error", "message": "An unexpected error occurred" }`

- **Code**: 503 SERVICE UNAVAILABLE
  - **Content**: `{ "status": "error", "error": "Service unavailable", "message": "The service is currently unavailable or in limited mode" }`