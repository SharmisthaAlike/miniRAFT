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
const VERBOSE_LOGS = process.env.VERBOSE_LOGS === "1";

// ─── State ───────────────────────────────────────────────────────────────────
let currentLeaderUrl = null;
let currentLeaderId = null;
let currentTerm = -1;
const clients = new Set();
const strokeBuffer = [];
const QUIET_BY_DEFAULT_EVENTS = new Set([
  "STROKE_RECEIVED_FROM_CLIENT",
  "STROKE_COMMITTED",
  "BROADCAST_SENT",
  "STROKE_BUFFERED"
]);

// ─── Logging ─────────────────────────────────────────────────────────────────
function glog(event, details = {}) {
  if (!VERBOSE_LOGS && QUIET_BY_DEFAULT_EVENTS.has(event)) return;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: "gateway",
    event,
    ...details
  }));
}

// ─── Leader Discovery ─────────────────────────────────────────────────────────
async function pollForLeader() {
  const results = await Promise.allSettled(
    REPLICAS.map(url =>
      axios.get(`${url}/status`, { timeout: 300 }).then(r => ({ url, ...r.data }))
    )
  );

  let newLeaderUrl = null;
  let newLeaderId = null;
  let newTerm = -1;

  for (const r of results) {
    if (r.status === "fulfilled") {
      const { url, role, id, term } = r.value;
      if (role === "leader" && term >= newTerm) {
        newLeaderUrl = url;
        newLeaderId = id;
        newTerm = term;
      }
    }
  }

  if (newLeaderId !== null) {
    if (newLeaderId !== currentLeaderId) {
      // Leader changed
      const prevLeader = currentLeaderId;
      currentLeaderUrl = newLeaderUrl;
      currentLeaderId = newLeaderId;
      currentTerm = newTerm;
      glog("LEADER_CHANGED", {
        from: prevLeader,
        to: newLeaderId,
        term: newTerm,
        url: newLeaderUrl,
        ts: new Date().toISOString()
      });
      broadcast({ type: "leader_changed", leaderId: newLeaderId, term: newTerm });

      // Flush buffered strokes
      if (strokeBuffer.length > 0) {
        glog("FLUSHING_BUFFER", { count: strokeBuffer.length });
        const toFlush = strokeBuffer.splice(0);
        for (const stroke of toFlush) {
          forwardToLeader(stroke).catch(() => {});
        }
      }
    } else {
      // Same leader — just keep term fresh
      currentTerm = newTerm;
    }
  } else {
    // No leader found
    if (currentLeaderId !== null) {
      glog("LEADER_LOST", { lastLeader: currentLeaderId });
      currentLeaderUrl = null;
      currentLeaderId = null;
    }
  }
}

setInterval(pollForLeader, 200);

// ─── Forward stroke to leader ─────────────────────────────────────────────────
async function forwardToLeader(stroke) {
  if (!currentLeaderUrl) {
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
      broadcast({
        type: "stroke_committed",
        stroke: data.stroke || stroke,
        index: data.index
      });
    }
    return data;
  } catch (err) {
    glog("FORWARD_FAILED", { error: err.message, strokeId: stroke.id });
    strokeBuffer.push(stroke);
    currentLeaderUrl = null;
    currentLeaderId = null;
    pollForLeader(); // immediate re-poll
    return { buffered: true };
  }
}

// ─── Broadcast to all WebSocket clients ──────────────────────────────────────
function broadcast(msg) {
  const payload = JSON.stringify(msg);
  let count = 0;
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(payload);
      count++;
    }
  }
  if (msg.type === "stroke_committed") {
    glog("BROADCAST_SENT", { type: msg.type, clients: count });
  }
}

// ─── WebSocket: accept browser connections ────────────────────────────────────
wss.on("connection", async (ws) => {
  clients.add(ws);
  glog("CLIENT_CONNECTED", { total: clients.size });

  ws.send(JSON.stringify({
    type: "connected",
    leaderId: currentLeaderId,
    term: currentTerm
  }));

  // Register message handler BEFORE any awaits so we never miss an early message
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

  // Fetch full log for late-joiner canvas initialization (AFTER registering handlers)
  if (currentLeaderUrl) {
    try {
      const { data } = await axios.get(`${currentLeaderUrl}/log`, { timeout: 1000 });
      // Only send entries that have been fully committed by the raft majority
      const committedStrokes = data.log
        .filter(e => e && e.index <= data.commitIndex && e.stroke)
        .map(e => ({ stroke: e.stroke, index: e.index }));

      if (ws.readyState === 1) { // only send if still connected
        ws.send(JSON.stringify({
          type: "init_canvas",
          log: committedStrokes
        }));
      }
    } catch (err) {
      glog("FETCH_LOG_FAILED", { error: err.message });
    }
  }
});

// ─── POST /broadcast (replicas push committed strokes here) ──────────────────
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
    buffered: strokeBuffer.length
  });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  glog("GATEWAY_STARTED", { port: PORT, replicas: REPLICAS });
  pollForLeader();
});