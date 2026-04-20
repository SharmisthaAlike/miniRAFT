const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const WebSocket = require("ws");

const PORT = parseInt(process.env.PORT || "8080", 10);
const STATIC_ROOT = __dirname;
const GATEWAY_TARGET = process.env.GATEWAY_TARGET || "http://gateway:3000";
const REPLICA_TARGETS = {
  r1: process.env.REPLICA1_TARGET || "http://replica1:3001",
  r2: process.env.REPLICA2_TARGET || "http://replica2:3002",
  r3: process.env.REPLICA3_TARGET || "http://replica3:3003"
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function proxyHttp(req, res, targetBase, targetPath) {
  const targetUrl = new URL(targetBase);
  const headers = { ...req.headers };
  delete headers.origin;
  delete headers.referer;
  headers.host = targetUrl.host;

  const options = {
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    method: req.method,
    path: targetPath,
    headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    sendJson(res, 502, { error: "proxy_failed", message: err.message });
  });

  req.pipe(proxyReq);
}

function serveStatic(req, res, pathname) {
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(STATIC_ROOT, decodeURIComponent(relativePath));

  if (!filePath.startsWith(STATIC_ROOT)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/api/gateway/status") {
    proxyHttp(req, res, GATEWAY_TARGET, "/status");
    return;
  }

  const replicaMatch = requestUrl.pathname.match(/^\/api\/replicas\/(r[123])\/status$/);
  if (replicaMatch) {
    const replicaId = replicaMatch[1];
    proxyHttp(req, res, REPLICA_TARGETS[replicaId], "/status");
    return;
  }

  serveStatic(req, res, requestUrl.pathname);
});

const gatewaySocketTarget = new URL(GATEWAY_TARGET);
const socketServer = new WebSocket.Server({ noServer: true });

socketServer.on("connection", (clientSocket, req) => {
  const backendSocket = new WebSocket(`${gatewaySocketTarget.protocol === "https:" ? "wss:" : "ws:"}//${gatewaySocketTarget.host}`);

  backendSocket.on("open", () => {
    clientSocket.on("message", (message) => {
      if (backendSocket.readyState === WebSocket.OPEN) {
        backendSocket.send(message);
      }
    });

    backendSocket.on("message", (message) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(message);
      }
    });
  });

  const closeBoth = () => {
    if (clientSocket.readyState === WebSocket.OPEN) clientSocket.close();
    if (backendSocket.readyState === WebSocket.OPEN || backendSocket.readyState === WebSocket.CONNECTING) backendSocket.close();
  };

  clientSocket.on("close", closeBoth);
  clientSocket.on("error", closeBoth);
  backendSocket.on("close", closeBoth);
  backendSocket.on("error", closeBoth);
});

server.on("upgrade", (req, socket, head) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  if (requestUrl.pathname === "/ws") {
    socketServer.handleUpgrade(req, socket, head, (ws) => {
      socketServer.emit("connection", ws, req);
    });
    return;
  }

  socket.destroy();
});

server.listen(PORT, () => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: "frontend",
    event: "FRONTEND_STARTED",
    port: PORT,
    gatewayTarget: GATEWAY_TARGET
  }));
});