#!/bin/bash
# Usage: ./blue-green-swap.sh replica1
REPLICA=${1:-replica1}

echo "=== Blue-Green Swap: $REPLICA ==="

echo "Step 1: Stopping $REPLICA..."
docker compose stop $REPLICA

echo "Step 2: Removing container..."
docker compose rm -f $REPLICA

echo "Step 3: Starting fresh $REPLICA..."
docker compose up -d $REPLICA

echo "Step 4: Watching logs (Ctrl+C to stop)..."
docker compose logs -f $REPLICA
