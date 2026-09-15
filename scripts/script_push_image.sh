#!/bin/bash
set -e

HARBOR="192.168.6.64"
PROJECT="banking"
TAG="v1"

SERVICES="auth-service account-service transfer-service notification-service game-service"

for svc in $SERVICES; do
  echo ">>> Building $svc (linux/amd64)..."
  docker buildx build --platform linux/amd64 \
    -f services/$svc/Dockerfile \
    -t $HARBOR/$PROJECT/$svc:$TAG \
    --load .
  
  echo ">>> Pushing $svc..."
  docker push $HARBOR/$PROJECT/$svc:$TAG
done

echo ">>> Building frontend (linux/amd64)..."
docker buildx build --platform linux/amd64 \
  -t $HARBOR/$PROJECT/frontend:$TAG \
  --load ./frontend

echo ">>> Pushing frontend..."
docker push $HARBOR/$PROJECT/frontend:$TAG

echo ">>> Hoàn tất Build & Push toàn bộ Services!"
