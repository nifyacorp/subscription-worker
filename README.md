# Nifya Subscription Worker

A Cloud Run service that processes subscription events from Pub/Sub and handles content analysis for DOGA and BOE sources. The service initializes with secure database connections and proper secret management.

## 🚀 Features

- **Secure Initialization**:
  - Secret Manager integration for credentials
  - Robust database connection pooling
  - Graceful shutdown handling
- **Real-time Processing**: Immediate processing of new subscriptions
- **Content Sources**:
  - DOGA (Diario Oficial de Galicia)
  - BOE (Boletín Oficial del Estado)
- **Flexible Scheduling**: Supports both immediate and daily processing frequencies
- **Smart Content Analysis**: Processes content based on user-defined prompts
- **Notification System**: Creates notifications and publishes real-time alerts via Pub/Sub

## 🏗 Project Structure

```
├── src/
│   ├── config.js           # Secret Manager configuration
│   ├── database.js         # Database pool management
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
- **Framework**: Express.js 4.x
- **Database**: PostgreSQL
- **Cloud Services**:
  - Google Cloud Run
  - Cloud Pub/Sub
  - Cloud SQL
  - Secret Manager

## 🔧 Initialization Process

The service follows a strict initialization sequence to ensure reliable operation:

1. **Secret Loading** (`config.js`):
   - Connects to Google Secret Manager
   - Retrieves database credentials:
     - DB_NAME
     - DB_USER
     - DB_PASSWORD
   - Sets environment variables securely

2. **Database Initialization** (`database.js`):
   - Creates connection pool with:
     - Max 20 clients
     - 30-second idle timeout
     - 2-second connection timeout
   - Implements retry logic (5 attempts)
   - Sets up event listeners for monitoring
   - Validates connection with test query

3. **Server Setup** (`server.js`):
   - Initializes Express application
   - Sets up Pub/Sub client
   - Configures subscription event endpoint
   - Establishes graceful shutdown handlers

4. **Error Handling**:
   - Comprehensive error logging
   - Automatic retry mechanisms
   - Graceful degradation

## 🔐 Required Secrets

The following secrets must be configured in Secret Manager:

- `DB_NAME`: Database name
- `DB_USER`: Database username
- `DB_PASSWORD`: Database password

## 🔌 Database Connection

Connects to Cloud SQL using Unix socket:
```
Host: /cloudsql/delta-entity-447812-p2:us-central1:nifya-db
Database: nifya
SSL: disabled (Unix socket)
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
# Build and deploy to Cloud Run
gcloud run deploy nifya-subscription-worker \
  --source . \
  --platform managed \
  --region us-central1 \
  --set-secrets=DB_NAME=DB_NAME:latest,DB_USER=DB_USER:latest,DB_PASSWORD=DB_PASSWORD:latest \
  --set-cloudsql-instances=delta-entity-447812-p2:us-central1:nifya-db
```

## 🔄 Startup Sequence

1. Service starts with `npm start`
2. Loads secrets from Secret Manager
3. Initializes database connection pool
4. Sets up Express server and Pub/Sub
5. Begins listening for events

## 🛑 Shutdown Process

The service implements graceful shutdown:

1. Captures SIGTERM/SIGINT signals
2. Closes database connections
3. Completes pending operations
4. Exits cleanly

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