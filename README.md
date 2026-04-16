# Mini-RAFT Distributed Drawing Board

A fault-tolerant real-time whiteboard backed by a simplified RAFT consensus protocol.

## Quick Start (Running the Project)

### Prerequisites (MacOS)
If you are running on macOS, ensure you have your Docker daemon running. If you do not have Docker Desktop, you can easily use Colima:
```bash
# Start the Docker daemon using Colima
colima start
```

### Starting the Cluster
```bash
# Start the Gateway, Frontend, and all 3 Replicas
docker-compose up -d --build

# Open the new Glassmorphic Frontend Dashboard
open http://localhost:8080

# Watch replica logs in real-time
docker-compose logs -f replica1 replica2 replica3
```

### Simulating Failovers
```bash
# Kill the current leader to trigger a new election
docker stop replica1

# Restart it (catch-up protocol automatically syncs logs)
docker start replica1
```

## Project Structure

```
miniraft/
├── docker-compose.yml
├── CONTRACTS.md        ← Agreed interfaces
├── ARCHITECTURE.md     ← Design doc submission
├── gateway/
│   ├── index.js        ← P2's component (WebSocket Handler)
│   ├── package.json
│   └── Dockerfile
├── replica1/           ← P1 + P3's components (RAFT Implementation)
├── replica2/
├── replica3/
└── frontend/           ← P4's component (Fully redesigned Glassmorphic Dashboard)
    ├── index.html
    ├── style.css
    └── app.js
```

## Environment Variables

| Var | Example | Used by |
|---|---|---|
| `REPLICA_ID` | `r1` | replicas |
| `PORT` | `3001` | all services |
| `PEERS` | `http://replica1:3001,...` | all services |
| `GATEWAY_URL` | `http://gateway:3000` | replicas |

## Pending Implementation / What's Left

Implementation for the core logic (Leader elections, AppendEntries RPC, Gateway WS forwarding, and Frontend Real-Time syncing logs) are complete! The following goals are left for final iteration prior to project wrap-up:

- **Blue-Green Replica Replacement**: Demonstrating zero-downtime hot reloading of existing replicas.
- **Failover Correctness Auditing**: Verifying that multi-client stroke syncing remains totally identical under extreme cluster conditions.
- **Bonus Feature (Optional)**: Implementing network partition simulation (split-brain).
- **Bonus Feature (Optional)**: Vector-based undo/redo using log compensation.
- **Cloud Deployment**: Deploying the Docker cluster to AWS EC2 or Google Cloud VMs.
