# Mini-RAFT Architecture Document
**Distributed Real-Time Drawing Board**
Week 1 — Design & Architecture

---

## 1. Cluster Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser Clients                       │
│        Tab 1            Tab 2            Tab 3              │
└────────┬────────────────┬────────────────┬───────────────── ┘
         │  WebSocket     │  WebSocket     │  WebSocket
         ▼                ▼                ▼
┌────────────────────────────────────────────────────────────┐
│                   GATEWAY  :3000                            │
│  • Manages all WebSocket sessions                           │
│  • Polls /status every 200ms to find leader                 │
│  • Forwards strokes → leader /append-entries                │
│  • Broadcasts committed strokes to all clients              │
└──────────────┬──────────────────────────────────────────────┘
               │  HTTP (Docker network: raft-net)
       ┌───────┼───────────────┐
       ▼       ▼               ▼
  ┌─────────┐  ┌─────────┐  ┌─────────┐
  │Replica 1│  │Replica 2│  │Replica 3│
  │  :3001  │  │  :3002  │  │  :3003  │
  │         │  │         │  │         │
  │ /request-vote         │  │         │
  │ /append-entries       │  │         │
  │ /heartbeat            │  │         │
  │ /sync-log             │  │         │
  │ /status               │  │         │
  └─────────┘  └─────────┘  └─────────┘
       ▲               ▲               ▲
       └───────────────┴───────────────┘
            RAFT RPCs (peer-to-peer)
```

---

## 2. RAFT State Transitions

```
                   ┌─────────────┐
            ╔══════│  FOLLOWER   │◄══════════════╗
            ║      └─────────────┘               ║
            ║        Election               Higher term
            ║        timeout                 received
            ▼                                    ║
      ┌─────────────┐     Split vote /        ┌─────────────┐
      │  CANDIDATE  │─────timeout─────────────│    LEADER   │
      └─────────────┘                         └─────────────┘
            │                                      ▲
            │   Majority votes received            │
            ╚══════════════════════════════════════╝
```

**Transition rules:**
- **Follower → Candidate**: election timeout fires (500–800ms random, no heartbeat received)
- **Candidate → Leader**: receives votes from ≥2 nodes (majority of 3)
- **Candidate → Follower**: discovers higher term OR times out (split vote → restart election)
- **Leader → Follower**: receives any RPC with term > currentTerm

---

## 3. Mini-RAFT Protocol Design

### 3.1 Leader Election
1. Follower starts a random 500–800ms timer on startup
2. If no heartbeat arrives before timeout → become **Candidate**
3. Increment `currentTerm`, set `votedFor = self`, send `POST /request-vote` to both peers
4. If ≥2 votes received → become **Leader**, immediately send heartbeats
5. If another leader's heartbeat arrives → revert to **Follower**
6. If neither (split vote) → wait random timeout, retry with incremented term

### 3.2 Log Replication
```
Client → Gateway → Leader (POST /append-entries)
         │
         Leader appends entry to local log
         │
         Leader sends AppendEntries to both followers
         │
         ├── Follower 1 acks
         └── Follower 2 acks
                │
         When ≥2 acks (majority): mark committed
                │
         Leader calls POST /broadcast on Gateway
                │
         Gateway fans out stroke_committed to all WebSocket clients
```

### 3.3 Catch-Up Protocol (Restarted Node)
```
1. Restarted node starts in Follower state, log = []
2. Leader sends AppendEntries (prevLogIndex = N)
3. Follower: prevLogIndex check fails → responds {success:false, logLength:0}
4. Leader sees mismatch → calls POST /sync-log on follower with {fromIndex: 0}
5. Follower receives all committed entries, appends them, updates commitIndex
6. Follower is now in sync — participates normally
```

---

## 4. API Specification

### POST /request-vote
| Field | Type | Description |
|---|---|---|
| term | int | Candidate's current term |
| candidateId | string | e.g. "r2" |
| lastLogIndex | int | Candidate's last log entry index |
| lastLogTerm | int | Term of candidate's last log entry |

**Response:** `{ term, voteGranted: bool }`

**Grant conditions:** term ≥ currentTerm AND (votedFor == null OR votedFor == candidateId)

---

### POST /append-entries
| Field | Type | Description |
|---|---|---|
| term | int | Leader's term |
| leaderId | string | e.g. "r1" |
| prevLogIndex | int | Index of entry before new ones |
| prevLogTerm | int | Term of prevLogIndex entry |
| entries | array | LogEntry objects to append |
| leaderCommit | int | Leader's commitIndex |

**Response:** `{ term, success: bool, logLength: int }`

**Reject if:** term < currentTerm OR log doesn't contain prevLogIndex entry with prevLogTerm

---

### POST /heartbeat
| Field | Type | Description |
|---|---|---|
| term | int | Leader's term |
| leaderId | string | |
| leaderCommit | int | Current commitIndex |

**Response:** `{ term, success: bool }`

---

### POST /sync-log
| Field | Type | Description |
|---|---|---|
| fromIndex | int | Follower's current log length (wants entries from here) |

**Response:** `{ entries: LogEntry[], commitIndex: int }`

---

### GET /status
**Response:** `{ id, role, term, leader, commitIndex, logLength }`

---

## 5. Failure Scenarios

| # | Scenario | Expected Behavior |
|---|---|---|
| 1 | Leader container killed | Remaining two replicas elect new leader within 1–2s |
| 2 | Network delay to one replica | Replica misses heartbeats → triggers election, but majority still quorate |
| 3 | Split vote | Both candidates restart election with incremented term |
| 4 | Restart mid-draw | Restarted replica catches up via /sync-log, no stroke lost |
| 5 | Two simultaneous clients | Both strokes committed in order, all canvases identical |
| 6 | Rapid restarts (5 in 30s) | Gateway buffers strokes during elections, no client disconnect |

---

## 6. Docker Architecture

```yaml
# raft-net: shared bridge network
gateway :3000   → replica1, replica2, replica3 (HTTP)
                ← browser clients (WebSocket)

replica1 :3001  ↔ replica2 :3002 ↔ replica3 :3003 (RAFT RPCs)

# Bind mounts for hot-reload:
./gateway  → /app  (nodemon watches)
./replica1 → /app  (nodemon watches)
./replica2 → /app  (nodemon watches)
./replica3 → /app  (nodemon watches)
```

Each service reads all config from environment variables — no hardcoded ports or IDs anywhere in source code.
