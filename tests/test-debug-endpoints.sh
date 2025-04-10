#!/bin/bash

# Test script for subscription worker debug endpoints
# This script can be used to test the debug endpoints for subscription types management

# Set the base URL for the subscription worker service
SERVICE_URL="https://subscription-worker-415554190254.us-central1.run.app"

# Test 1: Get all subscription types
echo "Testing GET /debug/subscription-types endpoint..."
curl -s "${SERVICE_URL}/debug/subscription-types" | jq .

# Test 2: Create/update a BOE subscription type
echo -e "\nTesting POST /debug/subscription-types to create BOE type..."
curl -X POST "${SERVICE_URL}/debug/subscription-types" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "boe",
    "description": "Spanish Official Bulletin parser",
    "icon": "document",
    "parser_url": "https://boe-parser-415554190254.us-central1.run.app",
    "metadata": {
      "language": "es",
      "country": "Spain"
    }
  }' | jq .

# Test 3: Create/update a DOGA subscription type
echo -e "\nTesting POST /debug/subscription-types to create DOGA type..."
curl -X POST "${SERVICE_URL}/debug/subscription-types" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "doga",
    "description": "Galician Official Diary parser",
    "icon": "document",
    "parser_url": "https://doga-parser-415554190254.us-central1.run.app",
    "metadata": {
      "language": "gl",
      "country": "Spain",
      "region": "Galicia"
    }
  }' | jq .

# Test 4: Verify subscription types were created/updated
echo -e "\nVerifying subscription types..."
curl -s "${SERVICE_URL}/debug/subscription-types" | jq .

echo -e "\nTest completed." 