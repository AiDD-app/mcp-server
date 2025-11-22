#!/bin/bash

# AiDD MCP Web Connector - Cloud Run Deployment Script
# Version: 4.0.0

set -e

# Configuration
PROJECT_ID="aidd-production-739193356129"
REGION="us-central1"
SERVICE_NAME="aidd-mcp-web-connector"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
PORT=8080

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                                            ║${NC}"
echo -e "${BLUE}║   🚀 AiDD MCP Web Connector - Cloud Run Deployment       ║${NC}"
echo -e "${BLUE}║                                                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ Error: gcloud CLI not found${NC}"
    echo "Please install: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Set project
echo -e "${YELLOW}📋 Setting GCP project...${NC}"
gcloud config set project ${PROJECT_ID}

# Enable required APIs
echo -e "${YELLOW}🔧 Enabling required APIs...${NC}"
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com

# Build the container
echo -e "${YELLOW}🏗️  Building container image...${NC}"
gcloud builds submit --tag ${IMAGE_NAME}

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Container built successfully${NC}"

# Deploy to Cloud Run
echo -e "${YELLOW}🚢 Deploying to Cloud Run...${NC}"
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME} \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --port ${PORT} \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 10 \
  --timeout 300 \
  --concurrency 80 \
  --set-env-vars NODE_ENV=production

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi

# Get service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --region ${REGION} \
  --format 'value(status.url)')

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}║   ✅ Deployment Successful!                               ║${NC}"
echo -e "${GREEN}║                                                            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}🌐 Service URL:${NC} ${SERVICE_URL}"
echo -e "${BLUE}🏥 Health Check:${NC} ${SERVICE_URL}/health"
echo -e "${BLUE}🔗 MCP Endpoint:${NC} ${SERVICE_URL}/mcp"
echo ""
echo -e "${YELLOW}📱 To use in Claude:${NC}"
echo -e "   1. Go to claude.ai settings"
echo -e "   2. Add MCP connector with URL: ${SERVICE_URL}/mcp"
echo -e "   3. Start using AiDD features!"
echo ""

# Test the deployment
echo -e "${YELLOW}🧪 Testing deployment...${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/health)

if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}✅ Health check passed!${NC}"
else
    echo -e "${RED}❌ Health check failed (HTTP ${HTTP_CODE})${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 All done! Your MCP web connector is live!${NC}"
