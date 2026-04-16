// ─── Configuration ─────────────────────────────────────────────────────────────
const GATEWAY_WS_URL = `ws://${location.hostname}:3000`;
const REPLICAS = [
  { id: 'r1', url: `http://${location.hostname}:3001/status` },
  { id: 'r2', url: `http://${location.hostname}:3002/status` },
  { id: 'r3', url: `http://${location.hostname}:3003/status` }
];

// ─── DOM Elements ────────────────────────────────────────────────────────────
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const container = document.getElementById("canvas-container");

const connectionBadge = document.getElementById("connection-badge");
const dockStats = document.getElementById("dock-stats");
const clearBtn = document.getElementById("clear-btn");
const gatewayLog = document.getElementById("gateway-log");
const toastContainer = document.getElementById("toast-container");

// ─── State ───────────────────────────────────────────────────────────────────
let drawing = false;
let lastX = 0, lastY = 0;
let currentColor = "#1d1d1d";
let strokeCount = 0;
const clientId = "client-" + Math.random().toString(36).slice(2, 8);
let ws = null;

// ─── Canvas Resizing Setup ───────────────────────────────────────────────────
function resizeCanvas() {
  // Make canvas fill the container perfectly without scaling blur
  const rect = container.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ─── Toast Notification System ───────────────────────────────────────────────
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function updateLog(msg) {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = `> ${msg}`;
  gatewayLog.appendChild(line);
  gatewayLog.scrollTop = gatewayLog.scrollHeight;
}

// ─── Top Connection Badge ────────────────────────────────────────────────────
function setConnectionStatus(type, text) {
  connectionBadge.className = `status-badge ${type}`;
  connectionBadge.innerHTML = `<div class="indicator"></div> ${text}`;
}

// ─── Cluster Dashboard Poller ────────────────────────────────────────────────
async function pollCluster() {
  for (const replica of REPLICAS) {
    const card = document.getElementById(`node-${replica.id}`);
    const roleEl = card.querySelector('.node-role');
    const termEl = card.querySelector('.stat-term');
    const logEl = card.querySelector('.stat-log');

    try {
      const res = await fetch(replica.url, { timeout: 400 });
      if (!res.ok) throw new Error("HTTP error");
      const data = await res.json();

      card.className = `node-card ${data.role}`;
      roleEl.textContent = data.role;
      termEl.textContent = data.term;
      logEl.textContent = data.logLength || data.logSize || data.log?.length || 0;

      // Heartbeat pulse if leader
      if (data.role === 'leader') {
        // UI CSS handles pulse animation automatically via .leader class
      }
    } catch (err) {
      card.className = 'node-card offline';
      roleEl.textContent = 'OFFLINE';
      termEl.textContent = '-';
      logEl.textContent = '-';
    }
  }
}

// Poll every 500ms
setInterval(pollCluster, 500);

// ─── WebSocket Logic ─────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(GATEWAY_WS_URL);

  ws.onopen = () => {
    setConnectionStatus('leader', 'Connected to Gateway');
    updateLog("WebSocket connected.");
    showToast("Connected to Gateway", "success");
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === "connected") {
      updateLog(`Cluster leader is ${msg.leaderId || 'unknown'} (Term ${msg.term})`);
    }

    if (msg.type === "leader_changed") {
      updateLog(`FAILOVER! New leader: ${msg.leaderId} (Term ${msg.term})`);
      showToast(`Leader Changed to ${msg.leaderId}`, "warning");
    }

    if (msg.type === "stroke_committed") {
      drawStroke(msg.stroke);
      strokeCount++;
      dockStats.textContent = `Strokes: ${strokeCount}`;
    }
  };

  ws.onclose = () => {
    setConnectionStatus('no-leader', 'Disconnected');
    updateLog("Gateway disconnected. Reconnecting...");
    showToast("Disconnected from Gateway", "error");
    setTimeout(connect, 1500); // Auto-reconnect
  };

  ws.onerror = () => {
    setConnectionStatus('no-leader', 'Connection Error');
  };
}

// ─── Drawing Engine ──────────────────────────────────────────────────────────
function drawStroke(stroke) {
  ctx.beginPath();
  ctx.moveTo(stroke.x0, stroke.y0);
  ctx.lineTo(stroke.x1, stroke.y1);
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.stroke();
}

function sendStroke(x0, y0, x1, y1) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const stroke = {
    id: crypto.randomUUID(),
    x0: Math.round(x0), y0: Math.round(y0),
    x1: Math.round(x1), y1: Math.round(y1),
    color: currentColor,
    clientId
  };
  ws.send(JSON.stringify(stroke));
}

// ─── Input Handling ──────────────────────────────────────────────────────────
function getCoordinates(e) {
  const r = canvas.getBoundingClientRect();
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
  }
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function startDrawing(e) {
  drawing = true;
  const { x, y } = getCoordinates(e);
  lastX = x;
  lastY = y;
}

function moveDrawing(e) {
  if (!drawing) return;
  const { x, y } = getCoordinates(e);
  // Send over network; Wait for backend stroke_committed broadcast before drawing locally
  sendStroke(lastX, lastY, x, y);
  lastX = x;
  lastY = y;
}

function stopDrawing() {
  drawing = false;
}

// Mouse
canvas.addEventListener("mousedown", startDrawing);
canvas.addEventListener("mousemove", moveDrawing);
window.addEventListener("mouseup", stopDrawing);

// Touch
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); startDrawing(e); }, { passive: false });
canvas.addEventListener("touchmove", (e) => { e.preventDefault(); moveDrawing(e); }, { passive: false });
window.addEventListener("touchend", stopDrawing);

// ─── Tools & Color Picker ────────────────────────────────────────────────────
document.querySelectorAll(".color-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".color-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentColor = btn.dataset.color;
  });
});

clearBtn.addEventListener("click", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Optional: We do not broadcast clear command across network per original logic
  // Just clear local view. 
  strokeCount = 0;
  dockStats.textContent = `Strokes: 0`;
});

// ─── Boot Mechanism ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  connect();
  // Poll immediately on load
  pollCluster();
});
