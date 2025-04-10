#!/bin/bash

# Set project ID
PROJECT_ID="delta-entity-447812-p2"

# Create secrets for Pub/Sub configuration
echo "Creating secrets for Pub/Sub configuration..."

# Main Topic
echo "processor-results" | \
gcloud secrets create "PUBSUB_TOPIC_NAME" \
    --project="$PROJECT_ID" \
    --replication-policy="automatic" \
    --data-file=-

# Main Subscription
echo "notifications-worker" | \
gcloud secrets create "PUBSUB_SUBSCRIPTION_NAME" \
    --project="$PROJECT_ID" \
    --replication-policy="automatic" \
    --data-file=-

# DLQ Topic
echo "processor-results-dlq" | \
gcloud secrets create "PUBSUB_DLQ_TOPIC_NAME" \
    --project="$PROJECT_ID" \
    --replication-policy="automatic" \
    --data-file=-

# DLQ Subscription
echo "processor-results-dlq-sub" | \
gcloud secrets create "PUBSUB_DLQ_SUBSCRIPTION_NAME" \
    --project="$PROJECT_ID" \
    --replication-policy="automatic" \
    --data-file=-

# Subscription Configuration
echo "7d" | \
gcloud secrets create "PUBSUB_MESSAGE_RETENTION" \
    --project="$PROJECT_ID" \
    --replication-policy="automatic" \
    --data-file=-

echo "60" | \
gcloud secrets create "PUBSUB_ACK_DEADLINE" \
    --project="$PROJECT_ID" \
    --replication-policy="automatic" \
    --data-file=-

echo "5" | \
gcloud secrets create "PUBSUB_MAX_DELIVERY_ATTEMPTS" \
    --project="$PROJECT_ID" \
    --replication-policy="automatic" \
    --data-file=-

echo "Created all Pub/Sub configuration secrets successfully"