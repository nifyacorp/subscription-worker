# Parser Communication Protocol

This document defines the standardized communication protocol between the subscription-worker service and all parser services (BOE Parser, DOGA Parser, etc.). The protocol ensures consistent API requests, error handling, and connection management.

## 1. Overview

The communication protocol provides:
- Standardized request and response formats
- Schema validation using Zod
- Robust error handling with retry mechanism
- Socket hang-up prevention using HTTP keep-alive
- Consistent logging

## 2. API Request Format

All requests to parser services use this standardized format:

```json
{
  "texts": ["prompt1", "prompt2"],
  "metadata": {
    "user_id": "user-id-value",
    "subscription_id": "subscription-id-value"
  },
  "limit": 5,
  "date": "YYYY-MM-DD"
}
```

### Required Fields
- `texts`: Array of text prompts to analyze
- `metadata`: Object containing:
  - `user_id`: Identifier for the user
  - `subscription_id`: Identifier for the subscription

### Optional Fields
- `limit`: Maximum number of results per prompt (default: 5)
- `date`: ISO date string for contextual queries (default: current date)

## 3. API Response Format

All parser services return responses in this format:

```json
{
  "query_date": "YYYY-MM-DD",
  "results": [
    {
      "prompt": "original prompt text",
      "matches": [
        {
          "document_type": "DOCUMENT_TYPE",
          "title": "DOCUMENT_TITLE",
          "issuing_body": "ISSUING_BODY",
          "summary": "DOCUMENT_SUMMARY",
          "relevance_score": 0.95,
          "links": {
            "html": "HTML_URL",
            "pdf": "PDF_URL"
          }
        }
      ]
    }
  ],
  "metadata": {
    "total_items_processed": 45,
    "processing_time_ms": 1234
  }
}
```

## 4. Error Handling

### HTTP Status Codes
- `200`: Success
- `400`: Bad Request
- `401`: Unauthorized
- `429`: Too Many Requests
- `500`: Internal Server Error

### Error Response Format
```json
{
  "error": "Descriptive error message",
  "status": "error",
  "timestamp": "ISO_TIMESTAMP"
}
```

## 5. Network Connection Management

The protocol uses HTTP keep-alive connections to prevent socket hang-up errors:

- Keep-alive enabled: `true`
- Keep-alive timeout: 30 seconds
- Socket timeout: 60 seconds
- Max sockets per host: 100
- Max free sockets: 10

## 6. Retry Mechanism

Requests are automatically retried for certain error conditions:

### Retryable Errors
- Network timeouts (ECONNABORTED)
- Socket hang ups (ECONNRESET)
- Connection timeouts (ETIMEDOUT)
- Host unreachable (EHOSTUNREACH)
- HTTP 5xx responses
- HTTP 429 responses

### Retry Configuration
- Max retries: 3
- Initial delay: 1 second
- Maximum delay: 20 seconds
- Backoff algorithm: Exponential with jitter
- Timeout progression: 1.5x, 2.25x, 3.375x original timeout

## 7. Schema Validation

Request and response validation is performed using Zod schemas:

```javascript
// Request schema
const ParserRequestSchema = z.object({
  texts: z.array(z.string()).min(1),
  metadata: z.object({
    user_id: z.string(),
    subscription_id: z.string()
  }),
  limit: z.number().optional().default(5),
  date: z.string().optional()
});

// Response schema
const ParserResponseSchema = z.object({
  query_date: z.string(),
  results: z.array(z.object({
    prompt: z.string().optional(),
    matches: z.array(z.object({
      document_type: z.string(),
      title: z.string(),
      issuing_body: z.string().optional(),
      summary: z.string().optional(),
      relevance_score: z.number(),
      links: z.object({
        html: z.string().url(),
        pdf: z.string().url().optional()
      }).optional()
    }).passthrough())
  })),
  metadata: z.object({
    total_items_processed: z.number().optional(),
    processing_time_ms: z.number().optional()
  }).optional()
}).passthrough();
```

## 8. Parser Services

### BOE Parser
- Base URL: https://boe-parser-415554190254.us-central1.run.app
- Endpoint: POST /analyze-text
- Authentication: Bearer token

### DOGA Parser
- Base URL: https://doga-parser-415554190254.us-central1.run.app
- Endpoint: POST /analyze-text
- Authentication: Bearer token

## 9. Usage Example

```javascript
const { ParserClient } = require('./utils/parser-protocol');

// Create a parser client
const parserClient = new ParserClient({
  baseURL: 'https://boe-parser-415554190254.us-central1.run.app',
  apiKey: 'your-api-key',
  type: 'boe',
  logger
});

// Create a request
const requestBody = parserClient.createRequest(
  ['Search prompt 1', 'Search prompt 2'],
  'user-id',
  'subscription-id'
);

// Send the request
const result = await parserClient.send(requestBody);

// Process the result
console.log(`Found ${result.entries.length} matches`);

// Close connections when done
parserClient.close();
```