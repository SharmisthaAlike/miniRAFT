# miniRAFT — Distributed Drawing Board with RAFT Consensus

## Overview

miniRAFT is a distributed system implementing the RAFT consensus algorithm across multiple replicas.  
It features a real-time collaborative drawing board with leader election, fault tolerance, blue-green deployment, and a glassmorphic dashboard UI.

---

## Quick Start

### Prerequisites (macOS)
Ensure you have Docker running. Using Colima:
```bash
colima start
```

### Starting the Cluster
```bash
# Build and start Gateway, Frontend, and all 3 Replicas
docker-compose up -d --build

# Open the Glassmorphic Frontend Dashboard
open http://localhost:8080

# Watch replica logs in real-time
docker-compose logs -f replica1 replica2 replica3
```

### Simulating Failovers
```bash
# Kill the current leader to trigger a new election
docker stop replica1

# Restart it — catch-up protocol automatically syncs logs
docker start replica1
```

---

## Architecture

The system consists of:

| Service | Port | Role |
|---|---|---|
| gateway | 3000 | WebSocket broker, leader discovery, stroke forwarding |
| frontend | 8080 | Collaborative drawing dashboard |
| replica1 | 3001 | RAFT node (leader or follower) |
| replica2 | 3002 | RAFT node (leader or follower) |
| replica3 | 3003 | RAFT node (leader or follower) |

---

## Project Structure

```
miniraft/
├── docker-compose.yml
├── CONTRACTS.md          ← Agreed interfaces
├── ARCHITECTURE.md       ← Design doc submission
├── .github/
│   └── workflows/
│       └── ci.yml        ← GitHub Actions CI pipeline
├── tests/
│   └── integration.test.js   ← Jest integration tests
├── gateway/
│   ├── index.js          ← WebSocket Handler, leader discovery
│   ├── package.json
│   └── Dockerfile
├── replica1/             ← RAFT Implementation
├── replica2/
├── replica3/
└── frontend/             ← Glassmorphic Dashboard
    ├── index.html
    ├── style.css
    └── app.js
```

---

## Technologies Used

- Node.js / Express / WebSocket (`ws`)
- Docker & Docker Compose
- RAFT Consensus Algorithm
- GitHub Actions (CI/CD)
- Jest + Axios (Integration Testing)

---

## Key Features

### 1. Leader Election
- One replica is elected as leader; others act as followers
- Election occurs automatically on failure (within ~500ms)

### 2. Fault Tolerance
- If the leader crashes, a new leader is elected
- The gateway buffers strokes during elections and flushes them to the new leader

### 3. Real-Time Collaborative Drawing
- Multi-client WebSocket connections through the gateway
- Strokes are committed via RAFT log replication to all replicas
- Undo/Redo supported via log compensation

### 4. Blue-Green Deployment
A script safely restarts replicas without affecting the cluster:
```bash
./blue-green-swap.sh replica1
```

### 5. CI/CD Pipeline
Every PR and push to `master` runs the full integration test suite via GitHub Actions:
```bash
npm test      # runs tests/integration.test.js against live Docker cluster
```

---

## Environment Variables

| Var | Example | Used by |
|---|---|---|
| `REPLICA_ID` | `r1` | replicas |
| `PORT` | `3001` | all services |
| `PEERS` | `http://replica1:3001,...` | all services |
| `GATEWAY_URL` | `http://gateway:3000` | replicas |

---

## Pending / Roadmap

- **Failover Correctness Auditing**: Multi-client stroke syncing under extreme cluster conditions
- **Network Partition Simulation**: Split-brain scenarios (bonus)
- **Cloud Deployment**: AWS EC2 or Google Cloud VMs
