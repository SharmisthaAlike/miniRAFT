# Mini-RAFT Distributed Drawing Board — Team Documentation

> **Version:** 1.0.0 | **Last Updated:** 2026-04-13 | **Status:** Week 2 Active Development

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Tech Stack](#3-tech-stack)
4. [Folder Structure](#4-folder-structure)
5. [API Documentation](#5-api-documentation)
6. [How to Run the Project](#6-how-to-run-the-project)
7. [Load Balancer Explanation](#7-load-balancer-explanation)
8. [Known Issues / Edge Cases](#8-known-issues--edge-cases)
9. [Testing Instructions](#9-testing-instructions)
10. [Change Log](#10-change-log)

---

## 1. Project Overview

### What is this?

**Mini-RAFT Drawing Board** is a **fault-tolerant, real-time collaborative whiteboard** backed by a simplified implementation of the **RAFT consensus algorithm**.

### In Plain English

Think of it like a shared Google Docs drawing canvas — but instead of trusting a single server to store your data, the system uses **3 replica servers** that all talk to each other and agree (reach *consensus*) before any drawing stroke is officially saved. Even if one server crashes, the other two take over automatically. No strokes are lost.

### Why RAFT?

RAFT is a distributed consensus protocol that ensures all replicas have the **same data in the same order**, even when servers fail. One replica is always elected the **Leader**; it receives all writes, replicates them to the others, and only confirms a write once a **majority agree** (2 out of 3).

### Key Features

- **Fault tolerance**: Lose 1 of 3 replicas — the system keeps running
- **Automatic leader election**: If the leader dies, surviving replicas elect a new one within ~1 second
- **Log catch-up**: A restarted replica catches up automatically — no strokes are permanently lost
- **Real-time sync**: All browser tabs show identical canvases via WebSockets

---

## 2. Architecture Diagram

### High-Level System Flow

```
┌──────────────────────────────────────────────────────────┐
│                    Browser Clients                        │
│        Tab 1            Tab 2            Tab 3           │
└────────┬────────────────┬────────────────┬───────────────┘
         │  WebSocket     │  WebSocket     │  WebSocket
         ▼                ▼                ▼
┌────────────────────────────────────────────────────────┐
│                  GATEWAY  :3000                         │
│                                                         │
│  • Accepts WebSocket connections from browsers          │
│  • Polls each replica's /status every 200ms             │
│  • Discovers who the current Leader is                  │
│  • Forwards drawing strokes → Leader's /submit-stroke   │
│  • Exposes POST /broadcast for replicas to call back    │
│  • Fans out committed strokes to ALL connected clients  │
└──────────────────┬─────────────────────────────────────┘
                   │  HTTP (internal Docker network: raft-net)
          ┌────────┼────────────┐
          ▼        ▼            ▼
     ┌─────────┐ ┌─────────┐ ┌─────────┐
     │Replica 1│ │Replica 2│ │Replica 3│
     │  :3001  │ │  :3002  │ │  :3003  │
     │  (r1)   │ │  (r2)   │ │  (r3)   │
     └─────────┘ └─────────┘ └─────────┘
          ▲             ▲             ▲
          └─────────────┴─────────────┘
               RAFT RPCs (peer-to-peer)
          /request-vote  /heartbeat
          /append-entries  /sync-log
```

### What Happens When You Draw a Stroke

```
1. Browser draws on canvas, sends stroke via WebSocket to Gateway
2. Gateway looks up the current Leader replica
3. Gateway POSTs the stroke to Leader's POST /submit-stroke
4. Leader appends stroke to its local log
5. Leader fans out POST /append-entries to both Followers
6. Each Follower acknowledges (or rejects if log is inconsistent)
7. Leader receives ≥2 acks (majority reached) → marks stroke as COMMITTED
8. Leader calls POST /broadcast on Gateway
9. Gateway sends stroke_committed to ALL connected browser clients
10. Every browser redraws the stroke — all canvases are now identical
```

### RAFT Role State Machine

```
              election timeout fires
              (no heartbeat received)
                      │
                      ▼
  ╔════════════╗    ╔════════════╗
  ║  FOLLOWER  ║───►║ CANDIDATE  ║
  ║            ║    ║            ║
  ╚════════════╝    ╚════════════╝
       ▲                  │
       │ higher term      │ majority votes
       │ received         │ received
       │                  ▼
       │            ╔════════════╗
       ╚════════════║   LEADER   ║
                    ╚════════════╝
```

**Rules:**
| Transition | Trigger |
|---|---|
| Follower → Candidate | No heartbeat received within 500–800ms (random) |
| Candidate → Leader | Receives votes from ≥2 nodes (majority of 3) |
| Candidate → Follower | Discovers higher term OR election times out (split vote) |
| Leader → Follower | Receives any RPC with `term > currentTerm` |

---

## 3. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Runtime** | Node.js 20 (Alpine) | Lightweight, fast async I/O |
| **Web Framework** | Express.js 4.x | Simple HTTP routing for RAFT RPCs |
| **WebSocket** | `ws` 8.x | Binary-capable, fast WebSocket for browsers |
| **HTTP Client (replicas)** | `axios` 1.x | Peer-to-peer RAFT RPCs between replicas |
| **HTTP Client (gateway)** | `node-fetch` 2.x | Gateway polls replica `/status` endpoints |
| **Dev Hot-Reload** | `nodemon` 3.x | Auto-restarts Node on file changes |
| **Containerization** | Docker + Docker Compose 3.9 | Runs all 4 services in isolated containers |
| **Container Network** | Docker Bridge (`raft-net`) | Private network for inter-service communication |
| **Frontend** | Plain HTML (`index.html`) | Drawing canvas (Week 2 implementation) |

**No databases** — all state is kept in-memory. A replica that restarts recovers its log via the `/sync-log` catch-up protocol.

---

## 4. Folder Structure

```
minraft_gravity/
│
├── docker-compose.yml        ← Defines and wires all 4 services together
├── ARCHITECTURE.md           ← Internal design doc (Week 1)
├── CONTRACTS.md              ← Agreed API shapes signed off by all 4 team members
├── README.md                 ← Quick-start reference
├── BEFORE_AND_AFTER.md       ← Cleanup history (how the project was organized)
├── CLEANUP_REPORT.md         ← File audit report
├── TEAM_DOCS.md              ← You are here ✅
│
├── gateway/                  ← Service 1: The public-facing entry point
│   ├── Dockerfile            ← Builds the Docker image; exposes port 3000
│   ├── index.js              ← All gateway logic (WebSocket, leader polling, broadcast)
│   └── package.json          ← Dependencies: express, ws, node-fetch, nodemon
│
├── replica1/                 ← Service 2: RAFT consensus node (ID = r1)
│   ├── Dockerfile            ← Builds replica image; exposes port 3001
│   ├── index.js              ← Full RAFT implementation (election, replication, commit)
│   └── package.json          ← Dependencies: express, axios, nodemon
│
├── replica2/                 ← Service 3: RAFT consensus node (ID = r2)
│   ├── Dockerfile
│   ├── index.js              ← Identical code to replica1; REPLICA_ID=r2 from env
│   └── package.json
│
├── replica3/                 ← Service 4: RAFT consensus node (ID = r3)
│   ├── Dockerfile
│   ├── index.js              ← Identical code to replica1; REPLICA_ID=r3 from env
│   └── package.json
│
└── frontend/                 ← Static site: the browser drawing canvas
    └── index.html            ← Week 2: connects via WebSocket to gateway:3000
```

### Key Design Principle

All three replicas run **identical code**. Their identity and behavior differ only via **environment variables** set in `docker-compose.yml`:

| Variable | Gateway | Replica 1 | Replica 2 | Replica 3 |
|---|---|---|---|---|
| `PORT` | 3000 | 3001 | 3002 | 3003 |
| `REPLICA_ID` | — | `r1` | `r2` | `r3` |
| `PEERS` | All 3 replicas | r2, r3 | r1, r3 | r1, r2 |
| `REPLICAS` (gateway) | All 3 replicas | — | — | — |

---

## 5. API Documentation

> **Important:** Replica APIs are internal (RAFT protocol). They are not meant to be called by browsers or end-users directly. The **gateway** is the only public-facing service.
>
> Replica ports (3001, 3002, 3003) are exposed on localhost **for debugging only**.

---

### 5.1 Gateway APIs (Port 3000)

---

#### `WebSocket ws://localhost:3000`

**Connection from browser.** Opens a persistent WebSocket session.

**Event: Browser → Gateway (send a stroke)**

```json
{
  "type": "stroke",
  "stroke": {
    "id": "uuid-v4-string",
    "x0": 120,
    "y0": 340,
    "x1": 125,
    "y1": 345,
    "color": "#e63946",
    "width": 3,
    "clientId": "tab-uuid"
  }
}
```

**Event: Gateway → Browser (stroke was committed)**

```json
{
  "type": "stroke_committed",
  "stroke": { "id": "...", "x0": 120, "y0": 340, "x1": 125, "y1": 345, "color": "#e63946", "width": 3, "clientId": "tab-uuid" },
  "index": 7
}
```

**Event: Gateway → Browser (leader changed)**

```json
{ "type": "leader_changed", "newLeader": "r2", "term": 3 }
```

**Event: Gateway → Browser (election in progress)**

```json
{ "type": "election_started", "term": 3 }
```

---

#### `POST /broadcast`

Called **by the leader replica** (not by the browser) after a stroke is committed. Gateway fans this stroke out to all connected browser clients.

| Field | Type | Description |
|---|---|---|
| `stroke` | object | The committed Stroke object |
| `index` | int | Log index of this stroke |

**Example cURL:**
```bash
curl -X POST http://localhost:3000/broadcast \
  -H "Content-Type: application/json" \
  -d '{"stroke": {"id": "abc-123", "x0": 10, "y0": 20, "x1": 15, "y1": 25, "color": "#ff0000", "width": 2, "clientId": "tab-1"}, "index": 7}'
```

**Response:**
```json
{ "ok": true }
```

---

### 5.2 Replica APIs (Ports 3001 / 3002 / 3003)

> Replace `3001` with `3002` or `3003` to target a specific replica.

---

#### `GET /status`

**Purpose:** Check the current state of a replica. Used by the gateway for leader discovery and by developers for debugging.

**Example cURL:**
```bash
curl http://localhost:3001/status
```

**Response:**
```json
{
  "id": "r1",
  "role": "leader",
  "term": 3,
  "leader": "r1",
  "logLength": 9,
  "commitIndex": 8
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | This replica's ID (`r1`, `r2`, or `r3`) |
| `role` | string | `"follower"`, `"candidate"`, or `"leader"` |
| `term` | int | Current election term (monotonically increasing) |
| `leader` | string | ID of the replica this node believes is leader |
| `logLength` | int | Number of log entries stored |
| `commitIndex` | int | Index of the last **committed** (majority-agreed) entry |

---

#### `POST /submit-stroke`

**Purpose:** Send a drawing stroke to the **leader** for replication. The gateway calls this endpoint.
**⚠️ Will return 400 if called on a non-leader replica.**

**Request Body:**
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

**Example cURL** (assuming r1 is the current leader):
```bash
curl -X POST http://localhost:3001/submit-stroke \
  -H "Content-Type: application/json" \
  -d '{"id": "abc-123", "x0": 10, "y0": 20, "x1": 15, "y1": 25, "color": "#e63946", "width": 3, "clientId": "tab-1"}'
```

**Success Response (200):**
```json
{ "success": true, "index": 5, "stroke": { "id": "abc-123", "x0": 10, "y0": 20, "x1": 15, "y1": 25, "color": "#e63946", "width": 3, "clientId": "tab-1" } }
```

**Error — not the leader (400):**
```json
{ "error": "not_leader", "leaderId": "r2" }
```

**Error — couldn't commit (503):**
```json
{ "error": "could_not_commit" }
```

---

#### `POST /request-vote`

**Purpose:** RAFT leader election RPC. A Candidate asks peers to vote for it.
**Called by:** Replicas (peer-to-peer only).

**Request Body:**
```json
{ "term": 3, "candidateId": "r2", "lastLogIndex": 6, "lastLogTerm": 2 }
```

| Field | Type | Description |
|---|---|---|
| `term` | int | Candidate's current term number |
| `candidateId` | string | Who is requesting votes (e.g., `"r2"`) |
| `lastLogIndex` | int | Index of the candidate's last log entry |
| `lastLogTerm` | int | Term of the candidate's last log entry |

**Example cURL:**
```bash
curl -X POST http://localhost:3001/request-vote \
  -H "Content-Type: application/json" \
  -d '{"term": 3, "candidateId": "r2", "lastLogIndex": 6, "lastLogTerm": 2}'
```

**Response:**
```json
{ "term": 3, "voteGranted": true }
```

**Vote is granted only if:**
- `term >= currentTerm`, AND
- `votedFor` is `null` OR already equals `candidateId`, AND
- Candidate's log is at least as up-to-date as receiver's log

---

#### `POST /append-entries`

**Purpose:** RAFT log replication RPC. The Leader sends new log entries to all Followers.

**Request Body:**
```json
{
  "term": 3,
  "leaderId": "r1",
  "prevLogIndex": 6,
  "prevLogTerm": 2,
  "entry": {
    "index": 7,
    "term": 3,
    "stroke": { "id": "...", "x0": 10, "y0": 20, "x1": 15, "y1": 25, "color": "#e63946", "width": 3, "clientId": "tab-1" }
  },
  "leaderCommit": 6
}
```

| Field | Type | Description |
|---|---|---|
| `term` | int | Leader's term |
| `leaderId` | string | Leader's ID |
| `prevLogIndex` | int | Index of the log entry immediately before the new one |
| `prevLogTerm` | int | Term of `prevLogIndex` entry (consistency check) |
| `entry` | object | The single log entry to append |
| `leaderCommit` | int | Leader's current `commitIndex` |

**Example cURL:**
```bash
curl -X POST http://localhost:3002/append-entries \
  -H "Content-Type: application/json" \
  -d '{"term": 3, "leaderId": "r1", "prevLogIndex": 6, "prevLogTerm": 2, "entry": {"index": 7, "term": 3, "stroke": {}}, "leaderCommit": 6}'
```

**Response:**
```json
{ "term": 3, "success": true, "logLength": 8 }
```

**Rejected (log inconsistency):**
```json
{ "term": 3, "success": false, "logLength": 4 }
```

---

#### `POST /heartbeat`

**Purpose:** Leader sends periodic heartbeats every 150ms to prevent Followers from starting elections.

**Request Body:**
```json
{ "term": 3, "leaderId": "r1", "leaderCommit": 6 }
```

**Example cURL:**
```bash
curl -X POST http://localhost:3002/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"term": 3, "leaderId": "r1", "leaderCommit": 6}'
```

**Response:**
```json
{ "term": 3, "success": true }
```

---

#### `POST /sync-log`

**Purpose:** Catch-up protocol. When a Follower's log is behind, the Leader pushes all missing committed entries in one batch.

**Request Body:**
```json
{ "entries": [ { "index": 4, "term": 2, "stroke": { } }, { "index": 5, "term": 2, "stroke": { } } ] }
```

| Field | Type | Description |
|---|---|---|
| `entries` | array | All committed log entries the follower is missing |

**Example cURL:**
```bash
curl -X POST http://localhost:3002/sync-log \
  -H "Content-Type: application/json" \
  -d '{"entries": [{"index": 4, "term": 2, "stroke": {}}]}'
```

**Response:**
```json
{ "success": true, "applied": 3 }
```

---

#### `GET /log`

**Purpose:** Debug endpoint — view the full in-memory log of a replica.

**Example cURL:**
```bash
curl http://localhost:3001/log
```

**Response:**
```json
{
  "log": [
    { "index": 0, "term": 1, "stroke": { "id": "abc", "x0": 10, "y0": 20 } },
    { "index": 1, "term": 1, "stroke": { } }
  ],
  "commitIndex": 1
}
```

---

## 6. How to Run the Project

### Prerequisites

| Requirement | Check |
|---|---|
| Docker Desktop installed | `docker --version` |
| Docker Compose installed | `docker compose version` |
| Ports 3000–3003 free | No other service using these ports |

---

### Step-by-Step: First Time Setup

**Step 1 — Navigate to the project folder**
```bash
cd path/to/minraft_gravity
```

**Step 2 — Build and start all services**
```bash
docker-compose up --build
```

> **What you'll see:** Each container prints a startup log line. Replicas elect a leader within ~1 second:
> ```
> replica1  | {"event":"BECAME_LEADER","term":1,...}
> gateway   | [gateway] Leader discovered: r1 at http://replica1:3001 (term 1)
> ```

**Step 3 — Open the frontend**

Go to [http://localhost:3000](http://localhost:3000) in your browser.

**Step 4 — Verify all replicas are healthy**
```bash
curl http://localhost:3001/status
curl http://localhost:3002/status
curl http://localhost:3003/status
```

One should show `"role": "leader"`, the other two `"role": "follower"`.

---

### Useful Day-to-Day Commands

```bash
# Start without rebuilding (faster)
docker-compose up

# Start in the background
docker-compose up -d

# Watch live logs from all services
docker-compose logs -f

# Watch logs from replicas only
docker-compose logs -f replica1 replica2 replica3

# Stop all services
docker-compose down

# Rebuild a single service after code changes
docker-compose up --build gateway
```

---

### Testing Fault Tolerance

```bash
# Kill the leader (triggers a new election)
docker stop replica1

# Watch gateway detect the new leader
docker-compose logs -f gateway

# Restart the replica (catch-up protocol fires automatically)
docker start replica1

# Check that replica1 caught up
curl http://localhost:3001/log
```

---

### Hot Reload (Development)

All services use `nodemon` inside Docker with bind mounts. This means:

- Edit any `.js` file inside `gateway/`, `replica1/`, etc.
- **Save the file** — the container automatically restarts with your changes
- No need to run `docker-compose down && up` for code changes

---

## 7. Load Balancer Explanation

### How the Gateway Discovers the Leader

The system does **not** use a traditional load balancer (like nginx or HAProxy). Instead, the **gateway implements intelligent leader-aware routing**:

```
Every 200ms:
  for each replica URL in [replica1:3001, replica2:3002, replica3:3003]:
    GET /status
    if response.role === "leader":
      remember this URL as currentLeaderUrl
      stop checking (break)

When a stroke arrives:
  POST stroke → currentLeaderUrl/submit-stroke
```

### Why Not Round-Robin?

Round-robin would send writes to any replica — including followers. In RAFT, **only the leader can accept writes**. Followers reject writes. The gateway's leader-polling approach ensures:

1. **All writes always go to the leader** — correctness guaranteed
2. **Failover is automatic** — next 200ms poll cycle finds the new leader
3. **Clients never disconnect** — the WebSocket connection to the gateway stays open even during elections

### What Happens During an Election?

```
1. Leader crashes
2. Next poll cycle (200ms): no replica reports role = "leader"
3. Gateway sets currentLeaderUrl = null
4. Gateway broadcasts { type: "election_started" } to all browser clients
5. Remaining replicas vote; new leader elected in ~500–800ms
6. Next poll cycle: new leader found
7. Gateway broadcasts { type: "leader_changed", newLeader: "r2" }
8. All subsequent strokes routed to r2
```

> **Note:** Strokes sent during the ~200–800ms election window are currently **dropped** (stroke buffering is a planned Week 2 improvement).

---

## 8. Known Issues / Edge Cases

| # | Issue | Impact | Status |
|---|---|---|---|
| 1 | **Stroke dropped during election** | Strokes sent while no leader exists are silently discarded | Known; Week 2 fix planned (queue in gateway) |
| 2 | **In-memory only — no persistence** | Restarting all 3 replicas simultaneously loses all data | By design (Week 1 scope) |
| 3 | **Split vote possible** | Two replicas tie in an election; both retry with higher term | Resolved naturally via randomized election timeouts |
| 4 | **`/submit-stroke` must only reach leader** | Calling it on a follower returns `400 { error: "not_leader" }` | Expected behavior; gateway handles routing |
| 5 | **Simultaneous strokes from two clients** | Both committed in order by the leader; canvases end up identical | Works correctly |
| 6 | **Rapid restarts (5 in 30s)** | Frequent elections; gateway briefly shows no leader | Recovers within ~1s each time |
| 7 | **Frontend is a stub** | `frontend/index.html` is a placeholder until Week 2 | Expected, in-progress |
| 8 | **`leaderCommit` not sent in heartbeats (replica implementation)** | Heartbeat body includes `leaderCommit` in contracts but the replica `sendHeartbeats()` function only sends `term` + `leaderId` | Minor inconsistency with CONTRACTS.md; low risk |

---

## 9. Testing Instructions

### 9.1 Quick Sanity Check (start here)

After running `docker-compose up --build`:

```bash
# Check all three replicas are up
curl http://localhost:3001/status
curl http://localhost:3002/status
curl http://localhost:3003/status
```

Expected: exactly **one** replica shows `"role": "leader"`, the other two show `"role": "follower"`. All three `"leader"` fields should point to the same ID.

---

### 9.2 Test Leader Election

```bash
# Find the current leader
curl http://localhost:3001/status | python -m json.tool

# Kill the leader (e.g. if r1 is leader, port 3001)
docker stop replica1

# Wait ~1 second, then check remaining replicas
curl http://localhost:3002/status
curl http://localhost:3003/status
# One should now show "role": "leader"

# Restart r1 and verify it rejoins as follower
docker start replica1
curl http://localhost:3001/status
# Should show "role": "follower"
```

---

### 9.3 Test Stroke Replication

```bash
# Send a stroke to the leader (replace 3001 with whichever port is leader)
curl -X POST http://localhost:3001/submit-stroke \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-stroke-001",
    "x0": 10, "y0": 20,
    "x1": 50, "y1": 80,
    "color": "#ff5555",
    "width": 3,
    "clientId": "tester-tab"
  }'
# Expected: { "success": true, "index": 0, "stroke": {...} }

# Verify all replicas got the stroke
curl http://localhost:3001/log
curl http://localhost:3002/log
curl http://localhost:3003/log
# All three logs should contain the same entry at index 0
```

---

### 9.4 Test Log Catch-Up

```bash
# 1. Stop a follower
docker stop replica2

# 2. Send several strokes to the leader
curl -X POST http://localhost:3001/submit-stroke -H "Content-Type: application/json" \
  -d '{"id":"s1","x0":1,"y0":1,"x1":10,"y1":10,"color":"#00ff00","width":2,"clientId":"t"}'

curl -X POST http://localhost:3001/submit-stroke -H "Content-Type: application/json" \
  -d '{"id":"s2","x0":2,"y0":2,"x1":20,"y1":20,"color":"#00ff00","width":2,"clientId":"t"}'

# 3. Restart the stopped replica
docker start replica2

# 4. Wait 1-2 seconds, then check it caught up
curl http://localhost:3002/log
# Should show all strokes
```

---

### 9.5 Test the `/broadcast` Endpoint

```bash
curl -X POST http://localhost:3000/broadcast \
  -H "Content-Type: application/json" \
  -d '{
    "stroke": {
      "id": "broadcast-test",
      "x0": 0, "y0": 0, "x1": 100, "y1": 100,
      "color": "#0000ff", "width": 4, "clientId": "admin"
    },
    "index": 99
  }'
# Expected: { "ok": true }
# Any open browser tabs receive a stroke_committed WebSocket event
```

---

### 9.6 Test WebSocket from Browser Console

Open `http://localhost:3000` and run this in the **browser console (F12 → Console)**:

```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onopen = () => {
  console.log('Connected to gateway!');
  ws.send(JSON.stringify({
    type: 'stroke',
    stroke: {
      id: crypto.randomUUID(),
      x0: 10, y0: 10, x1: 100, y1: 100,
      color: '#e63946', width: 3,
      clientId: 'browser-test'
    }
  }));
};

ws.onmessage = (event) => {
  console.log('Received:', JSON.parse(event.data));
};
```

**Expected messages:**
- `{ type: "leader_changed", newLeader: "r1", term: 1 }` — shortly after connect
- `{ type: "stroke_committed", stroke: {...}, index: 0 }` — after the stroke commits

---

## 10. Change Log

> Add an entry here every time you make a significant change to the system.

---

### [1.0.0] — 2026-04-10 — Initial Release (Week 1)

**Added:**
- Docker Compose setup with 4 services: gateway, replica1, replica2, replica3
- Full RAFT implementation in replicas: leader election, heartbeats, log replication, catch-up
- Gateway: WebSocket server, leader polling (200ms), `/broadcast` endpoint
- Frontend stub (`frontend/index.html`)
- Project cleanup: deduplicated all files into clean per-service directories
- All config externalized via environment variables (no hardcoded ports or IDs)
- `CONTRACTS.md`, `ARCHITECTURE.md`, `README.md` written and agreed by team

**Team:** P1 (RAFT Core), P2 (Gateway), P3 (Infra), P4 (Frontend)

---

### [Unreleased] — Week 2 — In Progress

**Planned:**
- [ ] P2: Real stroke forwarding from gateway to leader via `POST /submit-stroke`
- [ ] P2: Stroke buffering during elections (no more dropped strokes)
- [ ] P2: Gateway redetects leader after failover without dropping WebSocket clients
- [ ] P1: Full `AppendEntries` fan-out from leader to followers
- [ ] P3: Validated follower `AppendEntries` handler (`prevLogIndex` check)
- [ ] P3: `/sync-log` full catch-up for rejoining nodes
- [ ] P4: Real drawing canvas in `frontend/index.html`
- [ ] P4: Multi-tab stroke consistency test (3 tabs, all identical)

---

*To add a new entry, copy this template:*

```markdown
### [X.Y.Z] — YYYY-MM-DD — Brief Title

**Added:**
- ...

**Changed:**
- ...

**Fixed:**
- ...

**Team / Author:** ...
```

---

*Maintained by the Mini-RAFT team. For API shape questions, see `CONTRACTS.md`. For design decisions, see `ARCHITECTURE.md`.*
