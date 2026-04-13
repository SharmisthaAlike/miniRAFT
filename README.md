# Mini-RAFT Distributed Drawing Board

A fault-tolerant real-time whiteboard backed by a simplified RAFT consensus protocol.

## Quick Start

```bash
# Start everything
docker-compose up --build

# Open the frontend
open http://localhost:3000   # or serve frontend/index.html from any static server

# Watch replica logs
docker-compose logs -f replica1 replica2 replica3

# Kill a replica to trigger election
docker stop replica1

# Restart it (catch-up protocol fires)
docker start replica1
```

## Project Structure

```
miniraft/
├── docker-compose.yml
├── CONTRACTS.md        ← Week 1: all agreed interfaces (read this first!)
├── ARCHITECTURE.md     ← Week 1: design doc submission
├── gateway/
│   ├── index.js        ← P2's component
│   ├── package.json
│   └── Dockerfile
├── replica1/           ← P1 + P3's components (same code, different env)
├── replica2/
├── replica3/
└── frontend/
    └── index.html      ← P4's component
```

## Week 1 Exit Gates

- [ ] `docker-compose up` starts all 4 services with no crashes
- [ ] Each service prints a startup log line
- [ ] `GET http://localhost:3001/status` returns `{"id":"r1","role":"follower",...}`
- [ ] `GET http://localhost:3002/status` returns `{"id":"r2","role":"follower",...}`
- [ ] `GET http://localhost:3003/status` returns `{"id":"r3","role":"follower",...}`
- [ ] Frontend canvas loads and connects to gateway WebSocket without error
- [ ] Hot reload: edit `replica1/index.js`, save → container restarts automatically
- [ ] CONTRACTS.md signed off by all 4 members

## Environment Variables

| Var | Example | Used by |
|---|---|---|
| `REPLICA_ID` | `r1` | replicas |
| `PORT` | `3001` | all services |
| `PEERS` | `http://replica1:3001,...` | all services |
| `GATEWAY_URL` | `http://gateway:3000` | replicas |

## Week 2 Checklist (don't start until Week 1 gates pass)

- [ ] P1: Election timer fires, RequestVote RPC works, leader elected
- [ ] P1: AppendEntries fans out to followers, commit on majority ack
- [ ] P2: Stroke forwarding to leader working end-to-end
- [ ] P2: Gateway redetects leader after failover, no client disconnect
- [ ] P3: Follower AppendEntries handler validates prevLogIndex
- [ ] P3: /sync-log sends missing entries to rejoining node
- [ ] P4: Multi-tab stroke consistency verified (3 tabs, identical canvas)
