#!/bin/bash
set -e

# AiDD MCP Service V2 Deployment Script
# Uses declarative configuration (cloudrun.yaml) for reliable deployments.

PROJECT_ID="dev-trees-464016-k5"
REGION="us-central1"
SERVICE_NAME="aidd-mcp"
IMAGE_NAME="gcr.io/${PROJECT_ID}/aidd-mcp:latest"

echo "🚀 Deploying ${SERVICE_NAME} (V2/Unified)..."

# 1. Build Container
echo "📦 Building container image..."
gcloud builds submit --tag ${IMAGE_NAME} --project ${PROJECT_ID} .

# 2. Deploy Configuration
echo "⚙️  Applying Cloud Run configuration (cloudrun.yaml)..."
gcloud run services replace cloudrun.yaml --region ${REGION} --project ${PROJECT_ID}

echo "✅ Deployment Complete!"
