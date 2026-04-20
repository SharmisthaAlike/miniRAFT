#!/usr/bin/env bash
set -euo pipefail

# Usage: ./blue-green-swap.sh replica1
REPLICA=${1:-replica1}

if docker compose version >/dev/null 2>&1; then
	COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
	COMPOSE=(docker-compose)
else
	echo "docker compose or docker-compose is required" >&2
	exit 1
fi

echo "=== Blue-Green Swap: $REPLICA ==="

echo "Step 1: Stopping $REPLICA..."
"${COMPOSE[@]}" stop "$REPLICA"

echo "Step 2: Removing container..."
"${COMPOSE[@]}" rm -f "$REPLICA"

echo "Step 3: Starting fresh $REPLICA..."
"${COMPOSE[@]}" up -d "$REPLICA"

echo "Step 4: Watching logs (Ctrl+C to stop)..."
"${COMPOSE[@]}" logs -f "$REPLICA"
