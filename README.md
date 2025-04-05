# Subscription Worker Service

## Overview

The Subscription Worker is a microservice responsible for processing user subscriptions (primarily for BOE documents), matching them against user-defined criteria (prompts), and generating notifications when relevant documents are found. It runs on Google Cloud Run, utilizes PostgreSQL for data persistence, Google Secret Manager for sensitive configuration, and Google Pub/Sub for asynchronous notification publishing.

The codebase has been recently refactored to follow a clearer architectural pattern with improved Separation of Concerns (SoC).

## Features

- Asynchronous processing of individual subscriptions via API endpoint.
- Batch processing capabilities for pending subscriptions.
- Integration with an external parser service (e.g., BOE Parser) to analyze documents based on prompts.
- Creation of notifications in the database for matched documents.
- Optional publishing of notification events to a Pub/Sub topic for real-time updates.
- Dependency Injection for managing component lifecycles and dependencies.
- Structured logging using Pino.
- Graceful shutdown handling.
- Health check endpoint.
- Mock database mode for development environments when a real database is unavailable.

## Refactored Architecture

The service now follows a more layered architecture:

- **`index.js`**: Application entry point, responsible for initializing components, wiring dependencies, setting up the Express app, and starting the server.
- **`src/config`**: Modules for configuring database connections, logging, and secrets management.
- **`src/clients`**: Classes responsible for interacting with external services (e.g., `ParserClient` for the BOE parser, `NotificationClient` for Pub/Sub).
- **`src/repositories`**: Classes encapsulating all database interactions (e.g., `SubscriptionRepository`, `NotificationRepository`, `ProcessTrackingRepository`). They abstract SQL queries and interact directly with the database pool.
- **`src/services`**: Core business logic resides here (e.g., `SubscriptionService`). Services coordinate actions between repositories and clients to fulfill application use cases.
- **`src/controllers`**: Classes handling incoming HTTP requests, validating input (basic), calling appropriate service methods, and formatting responses (e.g., `SubscriptionController`).
- **`src/routes`**: Express router definitions that map URL paths and HTTP methods to controller methods. Middleware (like validation) is applied here.
- **`src/middleware`**: Reusable Express middleware functions (e.g., validation logic).
- **`src/utils`**: Shared utility functions (e.g., the `parser-protocol` helper).

### Functionality Flow (Example: Process Single Subscription)

```mermaid
graph LR
    A[HTTP POST /api/subscriptions/process/:id] --> B(Express Router);
    B --> C{Validation Middleware};
    C --> D[SubscriptionController];
    D -- 1. Create Record --> E[ProcessTrackingRepository];
    E -- DB Write --> F[(Database)];
    D -- 2. Respond 202 Accepted --> A;
    D -- 3. Trigger Async --> G[SubscriptionService];
    G -- 4. Find Subscription --> H[SubscriptionRepository];
    H -- DB Read --> F;
    G -- 5. Call Parser --> I[ParserClient];
    I -- HTTP Request --> J[(External Parser Service)];
    J -- HTTP Response --> I;
    G -- 6. Save Notification --> K[NotificationRepository];
    K -- DB Write --> F;
    G -- 7. Publish Notification? --> L[NotificationClient];
    L -- Pub/Sub Publish --> M[(Google Pub/Sub)];
    G -- 8. Update Subscription Status --> H;
    H -- DB Write --> F;
    G -- 9. Update Process Record --> E;
    E -- DB Write --> F;

    style F fill:#f9f,stroke:#333,stroke-width:2px
    style J fill:#ccf,stroke:#333,stroke-width:2px
    style M fill:#ccf,stroke:#333,stroke-width:2px
```

*(Diagram generated using Mermaid syntax)*

## API Endpoints

### Core Endpoints (mounted under `/api`)

- `GET /health` - Check service and database connection health.
- `POST /subscriptions/process/:id` - Queues a specific subscription for asynchronous processing. Responds with `202 Accepted` on success.
- `GET /subscriptions/pending` - Retrieves a list of subscription processing records currently in a pending state.
- `POST /subscriptions/batch/process` - Triggers the processing of pending subscriptions (implementation might be basic).

*(Refer to `src/routes/api/index.js` and associated router files for exact definitions and potential future endpoints like BOE-specific or Debug routes)*

## Setup & Development

### Prerequisites

- Node.js (Version specified in `package.json`, likely 16+)
- PostgreSQL Database (Running locally or accessible)
- Access to Google Cloud Project (for Secret Manager, Pub/Sub in production/staging)
- Google Cloud SDK (optional, for deployment)

### Environment Variables

Create a `.env` file in the root directory based on `.env.example` (if provided) or include the following:

```dotenv
# Application Settings
NODE_ENV=development # or production
PORT=8080
LOG_LEVEL=debug # Pino log levels: trace, debug, info, warn, error, fatal

# Google Cloud
PROJECT_ID=your-gcp-project-id # Required for Secret Manager & Pub/Sub
GOOGLE_CLOUD_PROJECT=your-gcp-project-id # Alternative/Synonym for PROJECT_ID

# Database Connection (using pg environment variables is common)
# Example using standard PG vars:
PGHOST=localhost
PGPORT=5432
PGUSER=your_db_user
PGPASSWORD=your_db_password
PGDATABASE=your_db_name
# Or connection string:
# DATABASE_URL=postgresql://user:password@host:port/database

# External Services
PARSER_BASE_URL=https://your-parser-service-url # URL of the external BOE parser
NOTIFICATION_TOPIC=subscription-notifications # Name of the Pub/Sub topic for notifications

# Secrets (These are typically *names* of secrets in Secret Manager, not the values themselves)
PARSER_API_KEY_SECRET_NAME=PARSER_API_KEY # Name of the secret holding the parser API key
# Add other secret names as needed (e.g., database credentials if fetched from secrets)

# Feature Flags / Debugging
# ENABLE_DEBUG_ROUTES=true # Uncomment to enable debug endpoints
```

*Note: Secrets like API keys and database passwords should ideally be managed via Google Secret Manager in production environments. The application reads secrets based on the `*_SECRET_NAME` variables.* 

### Installation

```bash
# Clone the repository
# git clone ...
# cd subscription-worker

# Install dependencies
npm install

# Create and configure your .env file
# cp .env.example .env # if example exists
# nano .env 
```

### Running the Service

```bash
# Run in development mode (uses nodemon for auto-restarts)
npm run dev

# Run in production mode
npm start
```

The service should start and log output to the console, indicating successful initialization and the port it's listening on.

## Debugging

- Set `LOG_LEVEL=debug` or `trace` in `.env` for verbose logging.
- Optional debug endpoints might be available under `/debug` if enabled via `ENABLE_DEBUG_ROUTES=true`. Check `src/routes/debug.js` for details.

## Deployment

The service is designed for deployment to serverless platforms like Google Cloud Run. A `Dockerfile` and potentially a `cloudbuild.yaml` file should be present for building and deploying container images.

Example deployment using Cloud Build and Cloud Run:

```bash
# Ensure gcloud SDK is authenticated and configured for your project
# gcloud auth login
# gcloud config set project YOUR_PROJECT_ID

# Submit build to Google Cloud Build
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/subscription-worker

# Deploy to Cloud Run (adjust flags as needed, especially environment variables/secrets)
gcloud run deploy subscription-worker \
  --image gcr.io/YOUR_PROJECT_ID/subscription-worker \
  --platform managed \
  --region YOUR_REGION \
  --allow-unauthenticated \ # Or configure authentication
  --set-env-vars=NODE_ENV=production,LOG_LEVEL=info \ # Add other ENV VARS
  --update-secrets=PARSER_API_KEY_SECRET_NAME=PARSER_API_KEY:latest # Map secrets
```

*Ensure the Cloud Run service account has permissions to access necessary services (Secret Manager, Pub/Sub, potentially Cloud SQL).* 

## Repository Structure (Refactored)

```
.
├── src/
│   ├── clients/          # External service clients (ParserClient, NotificationClient)
│   ├── config/           # Configuration (database, logger, secrets)
│   ├── controllers/      # Request/Response handlers (SubscriptionController)
│   ├── middleware/       # Express middleware (validation)
│   ├── repositories/     # Database access logic (SubscriptionRepository, etc.)
│   ├── routes/           # Express route definitions (api/index.js, health.js, etc.)
│   ├── services/         # Core business logic (SubscriptionService)
│   └── utils/            # Utility functions (parser-protocol)
├── scripts/              # Utility scripts (setup_dirs.js)
├── Dockerfile            # Container build definition
├── index.js              # Application entry point
├── package.json          # Project dependencies and scripts
├── package-lock.json     # Lockfile for dependencies
├── .env                  # Local environment variables (ignored by git)
├── .env.example          # Example environment variables
├── .gitignore            # Files/directories ignored by git
├── README.md             # This file
└── ... (Other config files like cloudbuild.yaml, ARCHITECTURE.md, etc.)
```

## Contributing

Contributions are welcome. Please ensure code adheres to existing patterns, includes relevant updates to documentation, and potentially adds tests if applicable.