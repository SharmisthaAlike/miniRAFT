const axios = require("axios");
const http = require("http");
const WebSocket = require("ws");

const GATEWAY_URL = "http://localhost:3000";
const WS_URL = "ws://localhost:3000";

// Use a shared http agent so we can destroy it cleanly after all tests
const agent = new http.Agent({ keepAlive: false });
const client = axios.create({ httpAgent: agent });

afterAll(() => {
  agent.destroy();
});

describe("MiniRAFT Integration Tests", () => {
  it("Gateway should be healthy", async () => {
    const response = await client.get(`${GATEWAY_URL}/status`);
    expect(response.status).toBe(200);
    expect(response.data.service).toBe("gateway");
  });

  it("Cluster should eventually elect a leader", async () => {
    let leader = null;
    let attempts = 0;
    const maxAttempts = 15;

    while (!leader && attempts < maxAttempts) {
      const response = await client.get(`${GATEWAY_URL}/status`);
      if (response.data.leader) {
        leader = response.data.leader;
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
    }

    expect(leader).not.toBeNull();
  }, 20000);

  it("Client can connect via WS, submit stroke, and receive commit", async () => {
    const mockStrokeId = `test-stroke-${Date.now()}`;

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error(`Timed out waiting for stroke_committed for id=${mockStrokeId}`));
      }, 10000);

      ws.on("open", () => {
        ws.send(JSON.stringify({
          id: mockStrokeId,
          points: [{ x: 50, y: 50 }],
          color: "blue",
          brushSize: 3,
          type: "draw"
        }));
      });

      ws.on("message", data => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "stroke_committed" && msg.stroke && msg.stroke.id === mockStrokeId) {
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        } catch (e) {
          // ignore non-JSON
        }
      });

      ws.on("error", err => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }, 12000);
});
