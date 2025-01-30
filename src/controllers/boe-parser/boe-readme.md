# BOE Analysis Service Controller Guide

## Overview

This guide explains how to integrate with the BOE (Boletín Oficial del Estado) Analysis Service. The service processes queries against the latest BOE publications using AI-powered analysis.

## Service Integration

### Base URL
```
https://your-boe-service.com
```

### Authentication
Add an authorization header to all requests:
```
Authorization: Bearer YOUR_API_KEY
```

## Endpoints

### 1. Analyze BOE Content
Analyze multiple text queries against the latest BOE content.

```http
POST /analyze-text
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY
```

#### Request Body
```json
{
  "texts": [
    "Find all resolutions about public employment",
    "List announcements about environmental grants",
    "Show orders related to education"
  ]
}
```

#### Response
```json
{
  "query_date": "2025-01-24",
  "boe_info": {
    "issue_number": "20",
    "publication_date": "2025-01-24",
    "source_url": "https://www.boe.es"
  },
  "results": [
    {
      "prompt": "Find all resolutions about public employment",
      "matches": [
        {
          "document_type": "RESOLUTION",
          "issuing_body": "Ministerio de Hacienda",
          "title": "Full document title",
          "dates": {
            "document_date": "2025-01-20",
            "publication_date": "2025-01-24"
          },
          "code": "BOE-A-2025-1234",
          "section": "III. Otras disposiciones",
          "department": "MINISTERIO DE HACIENDA",
          "links": {
            "pdf": "https://www.boe.es/boe/dias/2025/01/24/pdfs/BOE-A-2025-1234.pdf",
            "html": "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-1234"
          },
          "relevance_score": 0.95,
          "summary": "Brief description of the document content"
        }
      ],
      "metadata": {
        "match_count": 1,
        "max_relevance": 0.95
      }
    }
  ],
  "metadata": {
    "total_items_processed": 45,
    "processing_time_ms": 1234
  }
}
```

### 2. Get API Documentation
Retrieve comprehensive API documentation.

```http
GET /help
Authorization: Bearer YOUR_API_KEY
```

## Example Controller Implementation

### Node.js
```javascript
import axios from 'axios';

class BOEController {
  constructor(apiKey, baseURL = 'https://your-boe-service.com') {
    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async analyzeTexts(queries) {
    try {
      const response = await this.client.post('/analyze-text', {
        texts: queries
      });
      return response.data;
    } catch (error) {
      console.error('BOE Analysis failed:', error.message);
      throw error;
    }
  }

  async getApiDocs() {
    try {
      const response = await this.client.get('/help');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch API docs:', error.message);
      throw error;
    }
  }
}

// Usage example
const controller = new BOEController('your-api-key');

// Analyze multiple queries
const queries = [
  'Find employment resolutions',
  'Show education orders'
];

try {
  const results = await controller.analyzeTexts(queries);
  console.log('Analysis results:', results);
} catch (error) {
  console.error('Analysis failed:', error);
}
```

### Python
```python
import requests
from typing import List, Dict, Any

class BOEController:
    def __init__(self, api_key: str, base_url: str = 'https://your-boe-service.com'):
        self.base_url = base_url
        self.headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }

    def analyze_texts(self, queries: List[str]) -> Dict[str, Any]:
        try:
            response = requests.post(
                f'{self.base_url}/analyze-text',
                headers=self.headers,
                json={'texts': queries}
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f'BOE Analysis failed: {str(e)}')
            raise

    def get_api_docs(self) -> Dict[str, Any]:
        try:
            response = requests.get(
                f'{self.base_url}/help',
                headers=self.headers
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f'Failed to fetch API docs: {str(e)}')
            raise

# Usage example
controller = BOEController('your-api-key')

# Analyze multiple queries
queries = [
    'Find employment resolutions',
    'Show education orders'
]

try:
    results = controller.analyze_texts(queries)
    print('Analysis results:', results)
except Exception as e:
    print('Analysis failed:', str(e))
```

## Error Handling

The service returns standard HTTP status codes:

- `200`: Success
- `400`: Bad Request (invalid input)
- `401`: Unauthorized (invalid API key)
- `429`: Too Many Requests (rate limit exceeded)
- `500`: Internal Server Error

Error Response Format:
```json
{
  "error": "Descriptive error message"
}
```

## Rate Limits

- Maximum 100 requests per minute per API key
- Maximum 5 queries per request
- Maximum query length: 500 characters

## Best Practices

1. **Batch Queries**: Send multiple related queries in a single request instead of multiple requests
2. **Error Handling**: Implement proper error handling and retries for failed requests
3. **Caching**: Cache API responses when appropriate to reduce API calls
4. **Monitoring**: Track API response times and error rates
5. **Rate Limiting**: Implement client-side rate limiting to avoid hitting API limits

## Support

For API support or questions, contact:
- Email: api-support@your-boe-service.com
- Documentation: https://docs.your-boe-service.com