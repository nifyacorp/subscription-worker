# Subscription Worker Service

## Project Structure Note

**IMPORTANT:** This service uses `src/index.js` as the main entry point, NOT a root-level index.js file. Any changes to route registration or application initialization must be made in `src/index.js`.

## Overview

The Subscription Worker is a specialized microservice that functions as a subscription processor and router within the NIFYA platform. It acts as the central hub for handling subscription processing requests across various data sources and official bulletins. The service dynamically routes subscription requests to the appropriate parser based on the subscription type configuration stored in the database.

At its core, the Subscription Worker:

1. **Processes subscription requests** from users who want to monitor specific information in official publications and other data sources
2. **Routes processing requests** to the appropriate specialized parser services based on subscription type (BOE, DOGA, real-estate, etc.)
3. **Records notifications** when relevant information is found matching user-defined criteria
4. **Publishes notification events** for real-time updates across the platform

The service is built with flexibility as a priority, allowing the platform to easily add new subscription types and parser services without code modifications. It runs on Google Cloud Run, utilizes PostgreSQL for data persistence, Google Secret Manager for sensitive configuration, and Google Pub/Sub for asynchronous notification publishing.

## How It Works

### Multi-Source Subscription Processing

1. **Subscription Creation**: Users create subscriptions in the NIFYA platform, selecting a subscription type (BOE, DOGA, real-estate, etc.) and specifying search criteria (prompts)
2. **Processing Request**: The subscription worker receives a processing request, either for a specific subscription ID or as a batch job for all pending subscriptions
3. **Type Determination**: The worker queries the database to determine the subscription type and retrieves the associated parser URL from the `subscription_types` table
4. **Dynamic Routing**: Based on the subscription type, the worker dynamically configures its parser client to communicate with the appropriate specialized parser service
5. **Content Analysis**: The specialized parser service analyzes content sources based on the user's criteria and returns relevant matches
6. **Notification Creation**: When matches are found, the worker creates notifications in the database and optionally publishes events to Pub/Sub
7. **Status Update**: The subscription's processing status is updated to reflect the latest processing time and results

### Subscription Types

The system supports multiple subscription types, each configured in the `subscription_types` table with a specific parser URL:

- **BOE (Boletín Oficial del Estado)**: For monitoring Spain's official state bulletin
- **DOGA (Diario Oficial de Galicia)**: For monitoring Galicia's official regional bulletin
- **Real Estate**: For monitoring real estate listings and alerts
- **Custom Types**: Additional types can be added through database configuration without code changes

### Key Features

- **Universal Processing Interface**: Standard API for processing any subscription type
- **Dynamic Parser Selection**: Automatically routes to the correct parser service based on subscription type
- **Parser-Agnostic Protocol**: All parser services implement the same standardized communication protocol
- **Configurable Subscription Types**: New data sources can be added via database configuration
- **Asynchronous Processing**: Handles both individual and batch processing jobs
- **Notification Generation**: Creates and distributes notifications across the platform
- **Comprehensive Tracking**: Monitors and logs processing status and results

## Features

- Asynchronous processing of individual subscriptions via API endpoint.
- Batch processing capabilities for pending subscriptions.
- **Dynamic parser selection** based on subscription type.
- Integration with specialized parser services to analyze documents based on prompts.
- Creation of notifications in the database for matched documents.
- Optional publishing of notification events to a Pub/Sub topic for real-time updates.
- Dependency Injection for managing component lifecycles and dependencies.
- Structured logging using Pino.
- Graceful shutdown handling.
- Health check endpoint.
- Mock database mode for development environments when a real database is unavailable.

## Parser Service Protocol

All parser services (BOE, DOGA, etc.) follow the same standardized protocol for communication:

### Parser Input Schema

All parsers accept requests in the following format:

```json
{
  "texts": ["search term 1", "search term 2"],
  "metadata": {
    "user_id": "UUID",
    "subscription_id": "UUID",
    "type_id": "subscription-type",
    "type_name": "Subscription Type"
  },
  "date": "2025-04-04"  // Optional, defaults to current date
}
```

- **texts**: Array of search terms/prompts to analyze
- **metadata**: Contains user, subscription, and type identifiers
- **date**: Optional date to search documents for (defaults to current date)

### Parser Endpoints

- **Primary Endpoint**: `/analyze-text` - Used for analyzing documents based on prompts
- **Test/Debug Endpoints**: `/test-analyze` or `/test-pubsub` - Used for testing and debugging

### Example Prompts

Example prompt texts include:
- "Ayuntamiento Barcelona licitaciones" (Barcelona City Council tenders)
- "Subvenciones cultura" (Culture subsidies/grants)

These prompts are semantically analyzed against content sources to find relevant matches. The parser services process these matches and return detailed match information.

## Refactored Architecture

The service now follows a more layered architecture:

- **`index.js`**: Application entry point, responsible for initializing components, wiring dependencies, setting up the Express app, and starting the server.
- **`src/config`**: Modules for configuring database connections, logging, and secrets management.
- **`src/clients`**: Classes responsible for interacting with external services (e.g., `ParserClient` for parser services, `NotificationClient` for Pub/Sub).
- **`src/repositories`**: Classes encapsulating all database interactions (e.g., `SubscriptionRepository`, `NotificationRepository`, `ProcessTrackingRepository`). They abstract SQL queries and interact directly with the database pool.
- **`src/services`**: Core business logic resides here (e.g., `SubscriptionService`). Services coordinate actions between repositories and clients to fulfill application use cases.
- **`src/controllers`**: Classes handling incoming HTTP requests, validating input (basic), calling appropriate service methods, and formatting responses (e.g., `SubscriptionController`).
- **`src/routes`**: Express router definitions that map URL paths and HTTP methods to controller methods. Middleware (like validation) is applied here.
- **`src/middleware`**: Reusable Express middleware functions (e.g., validation logic).
- **`src/utils`**: Shared utility functions (e.g., the `parser-protocol` helper).

### Dynamic Parser Selection

The subscription worker now dynamically determines which parser service to use based on the subscription type. This process works as follows:

1. When a subscription processing request is received at `/api/subscriptions/process/:id`, the worker retrieves the subscription from the database
2. The subscription includes a `type_id` field that references the `subscription_types` table
3. The worker joins with the `subscription_types` table to get the associated `parser_url` for that subscription type
4. The `ParserClient` is dynamically configured with the correct parser URL before processing the subscription
5. The request is then sent to the appropriate parser service (e.g., BOE parser, DOGA parser)

This approach allows for easy addition of new parser services without code changes - simply add a new entry to the `subscription_types` table with the appropriate `parser_url`.

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
    G -- 5. Get Subscription Type Details --> F;
    G -- 6. Configure Parser Client --> I[ParserClient];
    I -- HTTP Request --> J[(Appropriate Parser Service)];
    J -- HTTP Response --> I;
    G -- 7. Save Notification --> K[NotificationRepository];
    K -- DB Write --> F;
    G -- 8. Publish Notification? --> L[NotificationClient];
    L -- Pub/Sub Publish --> M[(Google Pub/Sub)];
    G -- 9. Update Subscription Status --> H;
    H -- DB Write --> F;
    G -- 10. Update Process Record --> E;
    E -- DB Write --> F;

    style F fill:#f9f,stroke:#333,stroke-width:2px
    style J fill:#ccf,stroke:#333,stroke-width:2px
    style M fill:#ccf,stroke:#333,stroke-width:2px
```

*(Diagram generated using Mermaid syntax)*

## API Endpoints

### Core Endpoints (mounted under `/api`)

- `GET /health` - Check service and database connection health.
- `POST /api/subscriptions/process/:id` - Queues a specific subscription for asynchronous processing. Responds with `202 Accepted` on success. This is the **primary and preferred endpoint** for triggering subscription processing.
- `GET /api/subscriptions/pending` - Retrieves a list of subscription processing records currently in a pending state.
- `POST /api/subscriptions/batch/process` - Triggers the processing of pending subscriptions (implementation might be basic).

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
# Note: Parser URLs are now fetched dynamically from subscription_types table
# PARSER_BASE_URL is only used as a fallback if no parser_url is found in the subscription_types table
PARSER_BASE_URL=https://your-parser-service-url # Fallback URL for the external parser
NOTIFICATION_TOPIC=subscription-notifications # Name of the Pub/Sub topic for notifications

# Secrets (These are typically *names* of secrets in Secret Manager, not the values themselves)
PARSER_API_KEY_SECRET_NAME=PARSER_API_KEY # Name of the secret holding the parser API key
# Add other secret names as needed (e.g., database credentials if fetched from secrets)

# Feature Flags / Debugging
# ENABLE_DEBUG_ROUTES=true # Uncomment to enable debug endpoints
```

*Note: Secrets like API keys and database passwords should ideally be managed via Google Secret Manager in production environments. The application reads secrets based on the `*_SECRET_NAME` variables.* 

### Subscription Types Configuration

To add a new parser service:

1. Add a new entry to the `subscription_types` table with the appropriate details:

```sql
INSERT INTO subscription_types (id, name, display_name, parser_url, description, icon, is_system)
VALUES (
  'new-parser-type', 
  'new-parser', 
  'New Parser Display Name', 
  'https://new-parser-service-url.example.com',
  'Description of the new parser service',
  'IconName', 
  true
);
```

2. Create subscriptions that reference this subscription type via the `type_id` field.

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