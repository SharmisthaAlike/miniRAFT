const axios = require("axios");
const WebSocket = require("ws");

const GATEWAY_URL = "http://localhost:3000";
const WS_URL = "ws://localhost:3000";

describe("MiniRAFT Integration Tests", () => {
  it("Gateway should be healthy", async () => {
    const response = await axios.get(`${GATEWAY_URL}/status`);
    expect(response.status).toBe(200);
    expect(response.data.service).toBe("gateway");
  });

  it("Cluster should eventually elect a leader", async () => {
    let leader = null;
    let attempts = 0;
    const maxAttempts = 15;

    while (!leader && attempts < maxAttempts) {
      const response = await axios.get(`${GATEWAY_URL}/status`);
      if (response.data.leader) {
        leader = response.data.leader;
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
    }

    expect(leader).not.toBeNull();
  }, 20000);

  it("Client can connect via WS, submit stroke, and receive commit", (done) => {
    const ws = new WebSocket(WS_URL);
    const mockStrokeId = `test-stroke-${Date.now()}`;
    let isConnected = false;

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "connected") {
        isConnected = true;
        // submit stroke
        ws.send(JSON.stringify({
          id: mockStrokeId,
          points: [{ x: 50, y: 50 }],
          color: "blue",
          brushSize: 3,
          type: "draw"
        }));
      } else if (msg.type === "stroke_committed") {
        if (msg.stroke && msg.stroke.id === mockStrokeId) {
          ws.close();
          done();
        }
      }
    });

    ws.on("error", (err) => {
      done(err);
    });
  }, 10000);
});
