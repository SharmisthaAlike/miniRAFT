const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const axios = require("axios");

const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3000");
const REPLICAS = (process.env.REPLICAS || "")
  .split(",")
  .filter(Boolean);
// e.g. ["http://replica1:3001", "http://replica2:3002", "http://replica3:3003"]

// ─── State ───────────────────────────────────────────────────────────────────
let currentLeaderUrl = null;
let currentLeaderId = null;
let currentTerm = -1;
const clients = new Set(); // connected WebSocket clients
const strokeBuffer = [];   // buffer strokes during leader election gap

// ─── Logging ─────────────────────────────────────────────────────────────────
function glog(event, details = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "gateway", event, ...details }));
}

// ─── Leader Discovery (polls /status on all replicas every 200ms) ─────────────
async function pollForLeader() {
  const results = await Promise.allSettled(
    REPLICAS.map(url =>
      axios.get(`${url}/status`, { timeout: 300 }).then(r => ({ url, ...r.data }))
    )
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      const { url, role, id, term, leader } = r.value;
      if (role === "leader" && (term > currentTerm || id === currentLeaderId)) {
        if (id !== currentLeaderId) {
          // Leader changed!
          const prevLeader = currentLeaderId;
          currentLeaderUrl = url;
          currentLeaderId = id;
          currentTerm = term;
          glog("LEADER_CHANGED", { from: prevLeader, to: id, term, url });
          broadcast({ type: "leader_changed", leaderId: id, term });
          // Flush buffered strokes to new leader
          if (strokeBuffer.length > 0) {
            glog("FLUSHING_BUFFER", { count: strokeBuffer.length });
            const toFlush = strokeBuffer.splice(0);
            for (const stroke of toFlush) {
              forwardToLeader(stroke).catch(() => {});
            }
          }
        } else {
          // Same leader, just update term
          currentTerm = term;
        }
        return; // Found leader, done
      }
    }
  }

  // No leader found — election in progress
  if (currentLeaderId !== null) {
    glog("LEADER_LOST", { lastLeader: currentLeaderId });
    currentLeaderUrl = null;
    currentLeaderId = null;
  }
}

setInterval(pollForLeader, 200);

// ─── Forward stroke to current leader ────────────────────────────────────────
async function forwardToLeader(stroke) {
  if (!currentLeaderUrl) {
    // No leader yet — buffer it
    strokeBuffer.push(stroke);
    glog("STROKE_BUFFERED", { strokeId: stroke.id, bufferSize: strokeBuffer.length });
    return { buffered: true };
  }

  try {
    const { data } = await axios.post(
      `${currentLeaderUrl}/submit-stroke`,
      stroke,
      { timeout: 1000 }
    );

    if (data.success) {
      glog("STROKE_COMMITTED", { index: data.index, strokeId: stroke.id });
      // Broadcast committed stroke to all WebSocket clients
      broadcast({ type: "stroke_committed", stroke: data.stroke || stroke, index: data.index });
    }
    return data;
  } catch (err) {
    // Leader might be down — buffer and re-poll immediately
    glog("FORWARD_FAILED", { error: err.message, strokeId: stroke.id });
    strokeBuffer.push(stroke);
    currentLeaderUrl = null;
    currentLeaderId = null;
    pollForLeader(); // Immediate re-poll
    return { buffered: true };
  }
}

// ─── Broadcast to all WebSocket clients ──────────────────────────────────────
function broadcast(msg) {
  const payload = JSON.stringify(msg);
  let count = 0;
  for (const ws of clients) {
    if (ws.readyState === 1) { // OPEN
      ws.send(payload);
      count++;
    }
  }
  if (msg.type === "stroke_committed") {
    glog("BROADCAST_SENT", { type: msg.type, clients: count });
  }
}

// ─── WebSocket: accept browser connections ────────────────────────────────────
wss.on("connection", (ws, req) => {
  clients.add(ws);
  glog("CLIENT_CONNECTED", { total: clients.size });

  // Send current leader info to newly connected client
  ws.send(JSON.stringify({
    type: "connected",
    leaderId: currentLeaderId,
    term: currentTerm
  }));

  ws.on("message", async (raw) => {
    try {
      const stroke = JSON.parse(raw.toString());
      glog("STROKE_RECEIVED_FROM_CLIENT", { strokeId: stroke.id });
      await forwardToLeader(stroke);
    } catch (err) {
      glog("WS_MESSAGE_ERROR", { error: err.message });
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    glog("CLIENT_DISCONNECTED", { total: clients.size });
  });

  ws.on("error", (err) => {
    glog("CLIENT_ERROR", { error: err.message });
    clients.delete(ws);
  });
});

// ─── POST /broadcast (replicas can push committed strokes to gateway) ─────────
// Alternative to gateway polling — leader calls this after commit
app.post("/broadcast", (req, res) => {
  const { stroke, index } = req.body;
  broadcast({ type: "stroke_committed", stroke, index });
  res.json({ success: true });
});

// ─── GET /status ──────────────────────────────────────────────────────────────
app.get("/status", (req, res) => {
  res.json({
    service: "gateway",
    leader: currentLeaderId,
    leaderUrl: currentLeaderUrl,
    term: currentTerm,
    clients: clients.size,
    buffered: strokeBuffer.length,
  });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  glog("GATEWAY_STARTED", { port: PORT, replicas: REPLICAS });
  pollForLeader(); // Immediate first poll
});
