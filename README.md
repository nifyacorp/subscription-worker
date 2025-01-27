# Nifya Subscription Worker

A Cloud Run service that processes subscription events from Pub/Sub and handles content analysis for DOGA and BOE sources.

## 🚀 Features

- **Real-time Processing**: Immediate processing of new subscriptions
- **Content Sources**:
  - DOGA (Diario Oficial de Galicia)
  - BOE (Boletín Oficial del Estado)
- **Flexible Scheduling**: Supports both immediate and daily processing frequencies
- **Smart Content Analysis**: Processes content based on user-defined prompts
- **Notification System**: Creates notifications and publishes real-time alerts via Pub/Sub

## 🏗 Project Structure

```
.
├── src/
│   ├── database/
│   │   └── client.js         # PostgreSQL database client
│   ├── handlers/
│   │   └── subscription-handler.js  # Pub/Sub message handler
│   ├── processors/
│   │   ├── content-processor.js     # Base processor class
│   │   ├── doga.js                  # DOGA content processor
│   │   └── boe.js                   # BOE content processor
│   ├── services/
│   │   ├── doga.js                  # DOGA parser client
│   │   ├── boe.js                   # BOE parser client
│   │   └── pubsub.js               # Google Pub/Sub client
│   └── server.js                    # Express server setup
└── package.json
```

## 🛠 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Cloud Services**:
  - Google Cloud Run
  - Cloud Pub/Sub
  - Cloud SQL

## 🔧 Configuration

Environment variables required for operation:

```bash
# Database
DB_NAME=nifya
DB_USER=nifya
DB_PASSWORD=your-password-here

# Service URLs
DOGA_PARSER_URL=https://doga-parser-415554190254.us-central1.run.app
BOE_PARSER_URL=https://boe-parser.example.com

# Google Cloud
GOOGLE_CLOUD_PROJECT=your-project-id
INSTANCE_CONNECTION_NAME=your-instance-connection
PUBSUB_TOPIC=notifications
PORT=8080
```

## 📦 Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm start
```

## 🔄 Message Processing Flow

### 1. Subscription Event Structure

```typescript
interface SubscriptionEvent {
  type: 'subscription-created';
  data: {
    userId: string;
    subscriptionId: string;
    prompts: string[];
    frequency: 'immediate' | 'daily';
  }
}
```

### 2. Processing Steps

1. **Event Reception**
   - Validates Pub/Sub message structure
   - Decodes base64 message data
   - Validates required fields

2. **Subscription Processing**
   - Determines processing frequency (immediate/daily)
   - Retrieves subscription type from database
   - Initializes appropriate content processor

3. **Content Analysis**
   - Fetches latest content from source
   - Analyzes content against user prompts
   - Creates notifications for matches
   - Publishes real-time alerts

## 📊 Logging

Comprehensive logging is implemented throughout the processing flow:

- Message reception and decoding
- Event validation
- Processing steps
- Content analysis results
- Error tracking with full context

Logs use emoji prefixes for better visual scanning:
- 📥 Message reception
- 🔄 Processing events
- 🔍 Analysis operations
- ✅ Success indicators
- ❌ Error indicators

## 🚀 Deployment

```bash
# Build the container
gcloud builds submit --tag gcr.io/PROJECT_ID/nifya-subscription-worker

# Deploy to Cloud Run
gcloud run deploy nifya-subscription-worker \
  --image gcr.io/PROJECT_ID/nifya-subscription-worker \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

## 🔍 Health Check

The service provides a health check endpoint at `/` that returns a 200 OK response.

## 🐛 Error Handling

- **Client Errors (400)**
  - Invalid message format
  - Missing required fields
  - Invalid subscription type
  - Subscription not found

- **Server Errors (500)**
  - Database connection issues
  - Parser API failures
  - Pub/Sub publishing errors

## 📝 License

Private and confidential. All rights reserved.