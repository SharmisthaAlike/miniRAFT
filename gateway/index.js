// gateway/index.js
// Week 1 STUB — accepts WebSocket connections, polls replicas for leader, logs everything
// P2 fills in real forwarding and broadcast logic in Week 2

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── Config ────────────────────────────────────────────────────────
const REPLICA_URLS = (process.env.PEERS || 'http://replica1:3001,http://replica2:3002,http://replica3:3003')
  .split(',').filter(Boolean);

// ── State ─────────────────────────────────────────────────────────
let currentLeaderUrl = null;
let currentLeaderId = null;
let currentLeaderTerm = -1;
const clients = new Set();  // connected WebSocket clients

// ── WebSocket: accept browser connections ─────────────────────────
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[gateway] Client connected. Total: ${clients.size}`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'stroke') {
      console.log(`[gateway] Stroke received from client, forwarding to leader...`);
      // STUB: just log it. P2 wires up real forwarding in Week 2.
      forwardToLeader(msg.stroke);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[gateway] Client disconnected. Total: ${clients.size}`);
  });
});

// ── Leader Discovery ──────────────────────────────────────────────
async function pollLeader() {
  for (const url of REPLICA_URLS) {
    try {
      const res = await fetch(`${url}/status`, { timeout: 500 });
      const data = await res.json();
      if (data.role === 'leader') {
        if (data.id !== currentLeaderId || data.term !== currentLeaderTerm) {
          console.log(`[gateway] Leader discovered: ${data.id} at ${url} (term ${data.term})`);
          currentLeaderUrl = url;
          currentLeaderId = data.id;
          currentLeaderTerm = data.term;
          broadcast({ type: 'leader_changed', newLeader: data.id, term: data.term });
        }
        return;
      }
    } catch {
      // replica unreachable — skip
    }
  }
  // No leader found
  if (currentLeaderUrl) {
    console.log('[gateway] No leader found — election in progress?');
    currentLeaderUrl = null;
    currentLeaderId = null;
    broadcast({ type: 'election_started', term: currentLeaderTerm + 1 });
  }
}

setInterval(pollLeader, 200);

// ── Forwarding ────────────────────────────────────────────────────
async function forwardToLeader(stroke) {
  if (!currentLeaderUrl) {
    console.log('[gateway] No leader — stroke dropped (STUB: queue in Week 2)');
    return;
  }
  // STUB: log only. P2 implements real AppendEntries POST in Week 2.
  console.log(`[gateway] Would POST stroke to ${currentLeaderUrl}/append-entries`);
}

// ── Broadcast (called by leader after commit) ─────────────────────
app.post('/broadcast', (req, res) => {
  const { stroke, index } = req.body;
  console.log(`[gateway] Broadcasting committed stroke index=${index}`);
  broadcast({ type: 'stroke_committed', stroke, index });
  res.json({ ok: true });
});

function broadcast(msg) {
  const raw = JSON.stringify(msg);
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(raw);
  });
}

// ── Startup ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[gateway] Running on port ${PORT}`);
  console.log(`[gateway] Watching replicas: ${REPLICA_URLS.join(', ')}`);
});
