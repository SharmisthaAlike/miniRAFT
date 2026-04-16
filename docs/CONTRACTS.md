# Mini-RAFT Contracts
> All 4 team members must sign off on this before writing production code.
> Last updated: Week 1, Day 1–2

---

## 1. Stroke Message Format
Used by: P1 (log entries), P2 (forwarding), P4 (canvas send/receive)

```json
{
  "id": "uuid-v4-string",
  "x0": 120,
  "y0": 340,
  "x1": 125,
  "y1": 345,
  "color": "#e63946",
  "width": 3,
  "clientId": "tab-uuid"
}
```

---

## 2. Log Entry Schema
Used by: P1 (owns), P3 (sync-log), P2 (broadcast)

```json
{
  "index": 7,
  "term": 2,
  "stroke": { /* Stroke object above */ }
}
```

---

## 3. RPC Endpoint Shapes

### POST /request-vote
**Request:**
```json
{ "term": 3, "candidateId": "r2", "lastLogIndex": 6, "lastLogTerm": 2 }
```
**Response:**
```json
{ "term": 3, "voteGranted": true }
```

---

### POST /append-entries
**Request:**
```json
{
  "term": 3,
  "leaderId": "r1",
  "prevLogIndex": 6,
  "prevLogTerm": 2,
  "entries": [ /* array of LogEntry objects */ ],
  "leaderCommit": 6
}
```
**Response:**
```json
{ "term": 3, "success": true, "logLength": 7 }
```

---

### POST /heartbeat
**Request:**
```json
{ "term": 3, "leaderId": "r1", "leaderCommit": 6 }
```
**Response:**
```json
{ "term": 3, "success": true }
```

---

### POST /sync-log
**Request:**
```json
{ "fromIndex": 4 }
```
**Response:**
```json
{
  "entries": [ /* LogEntry objects from index 4 onward */ ],
  "commitIndex": 9
}
```

---

## 4. GET /status
Used by: P2 (leader discovery), P3 (health checks)

**Response:**
```json
{ "id": "r1", "role": "leader", "term": 3, "leader": "r1", "commitIndex": 9, "logLength": 9 }
```
`role` is one of: `"follower"`, `"candidate"`, `"leader"`

---

## 5. Gateway → Client WebSocket Events

**Client → Gateway (send stroke):**
```json
{ "type": "stroke", "stroke": { /* Stroke object */ } }
```

**Gateway → Client (committed stroke):**
```json
{ "type": "stroke_committed", "stroke": { /* Stroke object */ }, "index": 7 }
```

**Gateway → Client (leader changed):**
```json
{ "type": "leader_changed", "newLeader": "r2", "term": 3 }
```

**Gateway → Client (election in progress):**
```json
{ "type": "election_started", "term": 3 }
```

---

## 6. Replica IDs, Ports, and Environment Variables

| Service   | ID  | Port | Env var         |
|-----------|-----|------|-----------------|
| Gateway   | —   | 3000 | `PORT=3000`     |
| Replica 1 | r1  | 3001 | `REPLICA_ID=r1` |
| Replica 2 | r2  | 3002 | `REPLICA_ID=r2` |
| Replica 3 | r3  | 3003 | `REPLICA_ID=r3` |

All replicas read peer URLs from env:
```
PEERS=http://replica1:3001,http://replica2:3002,http://replica3:3003
GATEWAY_URL=http://gateway:3000
```

**No service hardcodes ports or IDs — always read from env.**

---

## Sign-off
- [ ] P1 (RAFT Core) — agreed
- [ ] P2 (Gateway) — agreed
- [ ] P3 (Infra) — agreed
- [ ] P4 (Frontend) — agreed
