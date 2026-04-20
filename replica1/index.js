const express = require("express");

const app = express();
app.use(express.json());

const PEER_FAILURE_LOG_INTERVAL_MS = 3000;
const peerFailureState = new Map();

function formatNetworkError(err) {
  if (!err) return "unknown error";
  const causeCode = err.cause && err.cause.code ? err.cause.code : null;
  if (causeCode) return `${err.message} (${causeCode})`;
  return err.message || String(err);
}

function onPeerRpcSuccess(peer) {
  const stateForPeer = peerFailureState.get(peer);
  if (stateForPeer && stateForPeer.consecutiveFailures > 0) {
    raftLog("PEER_RPC_RECOVERED", {
      peer,
      failures: stateForPeer.consecutiveFailures
    });
  }
  peerFailureState.set(peer, {
    consecutiveFailures: 0,
    lastLoggedAt: 0
  });
}

function logPeerRpcFailure(event, peer, error) {
  const now = Date.now();
  const stateForPeer = peerFailureState.get(peer) || {
    consecutiveFailures: 0,
    lastLoggedAt: 0
  };

  stateForPeer.consecutiveFailures += 1;

  const shouldLog =
    stateForPeer.consecutiveFailures === 1 ||
    now - stateForPeer.lastLoggedAt >= PEER_FAILURE_LOG_INTERVAL_MS;

  if (shouldLog) {
    raftLog(event, {
      peer,
      error,
      consecutiveFailures: stateForPeer.consecutiveFailures
    });
    stateForPeer.lastLoggedAt = now;
  }

  peerFailureState.set(peer, stateForPeer);
}

async function postJson(url, body, timeoutMs) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    const wrapped = new Error(formatNetworkError(err));
    wrapped.cause = err;
    throw wrapped;
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Keep default empty payload for non-JSON error responses.
  }

  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

// ─── Config ───────────────────────────────────────────────────────────────────
const REPLICA_ID = process.env.REPLICA_ID || "r1";
const PORT = parseInt(process.env.PORT || "3001");
const PEERS = (process.env.PEERS || "")
  .split(",")
  .filter(Boolean);
const VERBOSE_LOGS = process.env.VERBOSE_LOGS === "1";
const QUIET_BY_DEFAULT_EVENTS = new Set([
  "VOTE_GRANTED",
  "VOTE_DENIED",
  "VOTE_RECEIVED",
  "ENTRY_APPENDED",
  "COMMIT_INDEX_UPDATED",
  "STROKE_RECEIVED",
  "ENTRY_COMMITTED",
  "COMMIT_FAILED_NO_MAJORITY",
  "FOLLOWER_BEHIND"
]);

// ─── RAFT State ───────────────────────────────────────────────────────────────
const state = {
  currentTerm: 0,
  votedFor: null,
  log: [],
  commitIndex: -1,
  lastApplied: -1,
  nextIndex: {},
  matchIndex: {},
  role: "follower",
  leaderId: null,
  votesReceived: 0,
};

// ─── Election Timer ───────────────────────────────────────────────────────────
let electionTimer = null;

function randomTimeout() {
  return 500 + Math.floor(Math.random() * 300);
}

function resetElectionTimer() {
  clearTimeout(electionTimer);
  electionTimer = setTimeout(startElection, randomTimeout());
}

function stopElectionTimer() {
  clearTimeout(electionTimer);
}

function startElection() {
  if (state.role === "leader") return;
  becomeCandidate();
}

// ─── Logging ──────────────────────────────────────────────────────────────────
function raftLog(event, details = {}) {
  if (!VERBOSE_LOGS && QUIET_BY_DEFAULT_EVENTS.has(event)) return;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    id: REPLICA_ID,
    role: state.role,
    term: state.currentTerm,
    event,
    ...details
  }));
}

// ─── State Transitions ────────────────────────────────────────────────────────
function becomeFollower(term, leaderId = null) {
  const prevRole = state.role;
  const prevTerm = state.currentTerm;
  const prevLeader = state.leaderId;

  // Only clear vote when we observe a strictly newer term.
  if (term > state.currentTerm) {
    state.votedFor = null;
  }

  state.currentTerm = Math.max(state.currentTerm, term);
  state.role = "follower";
  state.leaderId = leaderId;
  state.votesReceived = 0;

  // Avoid heartbeat-level log spam; log only on meaningful transition/state change.
  const changed =
    prevRole !== "follower" ||
    prevTerm !== state.currentTerm ||
    prevLeader !== leaderId;
  if (changed) {
    raftLog("TRANSITION_TO_FOLLOWER", {
      from: prevRole,
      newLeader: leaderId,
      prevTerm,
      newTerm: state.currentTerm,
    });
  }

  stopHeartbeats();
  resetElectionTimer();
}

function becomeCandidate() {
  state.role = "candidate";
  state.currentTerm += 1;
  state.votedFor = REPLICA_ID;
  state.votesReceived = 1;
  state.leaderId = null;
  raftLog("ELECTION_STARTED", { term: state.currentTerm });
  resetElectionTimer();
  requestVotesFromPeers();
}

function becomeLeader() {
  state.role = "leader";
  state.leaderId = REPLICA_ID;
  stopElectionTimer();
  PEERS.forEach((peer) => {
    state.nextIndex[peer] = state.log.length;
    state.matchIndex[peer] = -1;
  });
  raftLog("BECAME_LEADER", { term: state.currentTerm });
  startHeartbeats();
}

// ─── RequestVote (outbound) ───────────────────────────────────────────────────
async function requestVotesFromPeers() {
  const lastLogIndex = state.log.length - 1;
  const lastLogTerm = lastLogIndex >= 0 ? state.log[lastLogIndex].term : -1;

  const promises = PEERS.map(async (peer) => {
    try {
      const data = await postJson(
        `${peer}/request-vote`,
        { term: state.currentTerm, candidateId: REPLICA_ID, lastLogIndex, lastLogTerm },
        300
      );
      onPeerRpcSuccess(peer);
      if (state.role !== "candidate") return;
      if (data.term > state.currentTerm) { becomeFollower(data.term); return; }
      if (data.voteGranted) {
        state.votesReceived += 1;
        raftLog("VOTE_RECEIVED", { from: peer, total: state.votesReceived });
        const majority = Math.floor((PEERS.length + 1) / 2) + 1;
        if (state.votesReceived >= majority && state.role === "candidate") becomeLeader();
      }
    } catch (err) {
      logPeerRpcFailure("VOTE_REQUEST_FAILED", peer, err.message);
    }
  });
  await Promise.allSettled(promises);
}

// ─── RequestVote RPC (inbound) ────────────────────────────────────────────────
app.post("/request-vote", (req, res) => {
  const { term, candidateId, lastLogIndex, lastLogTerm } = req.body;
  if (term > state.currentTerm) becomeFollower(term);

  const myLastLogIndex = state.log.length - 1;
  const myLastLogTerm = myLastLogIndex >= 0 ? state.log[myLastLogIndex].term : -1;
  const logOk =
    lastLogTerm > myLastLogTerm ||
    (lastLogTerm === myLastLogTerm && lastLogIndex >= myLastLogIndex);

  const voteGranted =
    term >= state.currentTerm &&
    (state.votedFor === null || state.votedFor === candidateId) &&
    logOk;

  if (voteGranted) {
    state.votedFor = candidateId;
    resetElectionTimer();
    raftLog("VOTE_GRANTED", { to: candidateId, term });
  } else {
    raftLog("VOTE_DENIED", { to: candidateId, term });
  }
  res.json({ term: state.currentTerm, voteGranted });
});

// ─── Heartbeat (outbound) ─────────────────────────────────────────────────────
let heartbeatInterval = null;

function startHeartbeats() {
  clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(sendHeartbeats, 150);
}

function stopHeartbeats() {
  clearInterval(heartbeatInterval);
}

async function sendHeartbeats() {
  if (state.role !== "leader") { stopHeartbeats(); return; }
  const promises = PEERS.map(async (peer) => {
    try {
      const data = await postJson(
        `${peer}/heartbeat`,
        { term: state.currentTerm, leaderId: REPLICA_ID },
        200
      );
      onPeerRpcSuccess(peer);
      if (data.term > state.currentTerm) { becomeFollower(data.term); stopHeartbeats(); }
    } catch (err) {
      logPeerRpcFailure("HEARTBEAT_FAILED", peer, err.message);
    }
  });
  await Promise.allSettled(promises);
}

// ─── Heartbeat RPC (inbound) ──────────────────────────────────────────────────
app.post("/heartbeat", (req, res) => {
  const { term, leaderId } = req.body;
  if (term < state.currentTerm) {
    raftLog("REJECTED_STALE_HEARTBEAT", { from: leaderId, theirTerm: term });
    return res.json({ term: state.currentTerm, success: false });
  }
  if (term > state.currentTerm || state.role !== "follower") {
    becomeFollower(term, leaderId);
  } else {
    state.leaderId = leaderId;
    resetElectionTimer();
  }
  res.json({ term: state.currentTerm, success: true });
});

// ─── AppendEntries RPC (inbound) ──────────────────────────────────────────────
app.post("/append-entries", (req, res) => {
  const { term, leaderId, prevLogIndex, prevLogTerm, entry, leaderCommit } = req.body;

  if (term < state.currentTerm) {
    return res.json({ term: state.currentTerm, success: false, logLength: state.log.length });
  }
  becomeFollower(term, leaderId);

  if (prevLogIndex >= 0) {
    const prev = state.log[prevLogIndex];
    if (!prev || prev.term !== prevLogTerm) {
      raftLog("LOG_INCONSISTENCY", { prevLogIndex, expected: prevLogTerm, got: prev?.term });
      return res.json({ term: state.currentTerm, success: false, logLength: state.log.length });
    }
  }

  if (entry) {
    if (state.log.length > prevLogIndex + 1) state.log.splice(prevLogIndex + 1);
    state.log.push(entry);
    raftLog("ENTRY_APPENDED", { index: entry.index, term: entry.term });
  }

  if (leaderCommit > state.commitIndex) {
    state.commitIndex = Math.min(leaderCommit, state.log.length - 1);
    raftLog("COMMIT_INDEX_UPDATED", { commitIndex: state.commitIndex });
  }

  res.json({ term: state.currentTerm, success: true, logLength: state.log.length });
});

// ─── Replicate entry to peers (fixed: walks nextIndex back until follower agrees) ──
async function replicateEntry(entry) {
  let acks = 1;

  const promises = PEERS.map(async (peer) => {
    let nextIdx = state.nextIndex[peer] ?? 0;
    let attempts = 0;

    while (attempts < 10) {
      attempts++;
      const prevLogIndex = nextIdx - 1;
      const prevLogTerm = prevLogIndex >= 0 ? (state.log[prevLogIndex]?.term ?? -1) : -1;

      try {
        const data = await postJson(
          `${peer}/append-entries`,
          {
            term: state.currentTerm,
            leaderId: REPLICA_ID,
            prevLogIndex,
            prevLogTerm,
            entry: state.log[nextIdx],
            leaderCommit: state.commitIndex
          },
          400
        );
          onPeerRpcSuccess(peer);

        if (data.term > state.currentTerm) { becomeFollower(data.term); return; }

        if (data.success) {
          state.matchIndex[peer] = nextIdx;
          state.nextIndex[peer] = nextIdx + 1;
          if (nextIdx === entry.index) {
            acks++;
            break; // reached the target entry, done
          }
          nextIdx++; // send next missing entry
        } else {
          // Follower rejected — step nextIndex back
          raftLog("FOLLOWER_BEHIND", { peer, theirLogLength: data.logLength });
          // Always move backward at least one slot to guarantee convergence.
          const hinted = typeof data.logLength === "number" ? data.logLength - 1 : nextIdx - 1;
          nextIdx = Math.max(0, Math.min(nextIdx - 1, hinted));
          state.nextIndex[peer] = nextIdx;
        }
      } catch (err) {
          logPeerRpcFailure("REPLICATE_FAILED", peer, err.message);
        break;
      }
    }
  });

  await Promise.allSettled(promises);

  const majority = Math.floor((PEERS.length + 1) / 2) + 1;
  if (acks >= majority && state.role === "leader") {
    state.commitIndex = entry.index;
    raftLog("ENTRY_COMMITTED", { index: entry.index, acks });
    return true;
  }
  raftLog("COMMIT_FAILED_NO_MAJORITY", { index: entry.index, acks });
  return false;
}

// ─── Catch-Up: leader pushes missing entries to a lagging follower ────────────
async function triggerCatchUp(peer, fromIndex) {
  try {
    const entries = state.log.slice(fromIndex).filter(e => e.index <= state.commitIndex);
    await postJson(`${peer}/sync-log`, { entries }, 1000);
    onPeerRpcSuccess(peer);
    raftLog("SYNC_LOG_SENT", { peer, fromIndex, count: entries.length });
  } catch (err) {
    logPeerRpcFailure("SYNC_LOG_FAILED", peer, err.message);
  }
}

// ─── /sync-log: follower receives catch-up entries ────────────────────────────
app.post("/sync-log", (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0)
    return res.json({ success: true, message: "nothing to sync" });

  entries.forEach(entry => {
    if (!state.log[entry.index]) state.log[entry.index] = entry;
  });
  const last = entries[entries.length - 1];
  state.commitIndex = Math.max(state.commitIndex, last.index);
  raftLog("SYNC_LOG_APPLIED", { count: entries.length, commitIndex: state.commitIndex });
  res.json({ success: true, applied: entries.length });
});

// ─── /submit-stroke: gateway calls this on the current leader ─────────────────
app.post("/submit-stroke", async (req, res) => {
  if (state.role !== "leader")
    return res.status(400).json({ error: "not_leader", leaderId: state.leaderId });

  const stroke = req.body;
  const entry = { index: state.log.length, term: state.currentTerm, stroke };
  state.log.push(entry);
  raftLog("STROKE_RECEIVED", { index: entry.index });

  const committed = await replicateEntry(entry);
  if (committed) res.json({ success: true, index: entry.index, stroke });
  else res.status(503).json({ error: "could_not_commit" });
});

// ─── /status: polled by gateway for leader discovery ─────────────────────────
app.get("/status", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.json({
    id: REPLICA_ID,
    role: state.role,
    term: state.currentTerm,
    leader: state.leaderId,
    logLength: state.log.length,
    commitIndex: state.commitIndex,
  });
});

// ─── /log: debug endpoint to inspect full log ─────────────────────────────────
app.get("/log", (req, res) => {
  res.json({ log: state.log, commitIndex: state.commitIndex });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  raftLog("REPLICA_STARTED", { port: PORT, peers: PEERS });
  resetElectionTimer();
});