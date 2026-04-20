#!/usr/bin/env node

const { spawnSync } = require("child_process");
const os = require("os");

function hasCommand(bin, args) {
  const check = spawnSync(bin, args, { stdio: "ignore" });
  return check.status === 0;
}

function composeBase() {
  if (hasCommand("docker", ["compose", "version"])) {
    return ["docker", ["compose"]];
  }
  if (hasCommand("docker-compose", ["version"])) {
    return ["docker-compose", []];
  }

  console.error("Docker Compose not found. Install Docker Desktop/Engine with Compose.");
  process.exit(1);
}

function runStatus(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function runOrExit(cmd, args) {
  const status = runStatus(cmd, args);
  process.exit(status);
}

function runCompose(bin, baseArgs, composeArgs) {
  return runStatus(bin, [...baseArgs, ...composeArgs]);
}

function openUrl(url) {
  const platform = os.platform();
  if (platform === "darwin") {
    return runStatus("open", [url]);
  }
  if (platform === "win32") {
    return runStatus("cmd", ["/c", "start", "", url]);
  }
  return runStatus("xdg-open", [url]);
}

const [bin, baseArgs] = composeBase();
const args = process.argv.slice(2);
const command = args[0] || "help";

switch (command) {
  case "up": {
    const composeArgs = args.includes("--build") ? ["up", "-d", "--build"] : ["up", "-d"];
    runOrExit(bin, [...baseArgs, ...composeArgs]);
    break;
  }
  case "down": {
    runOrExit(bin, [...baseArgs, "down"]);
    break;
  }
  case "logs": {
    const services = args.slice(1);
    runOrExit(bin, [...baseArgs, "logs", "-f", ...services]);
    break;
  }
  case "swap": {
    const replica = args[1] || "replica1";
    const steps = [
      ["stop", replica],
      ["rm", "-f", replica],
      ["up", "-d", replica],
      ["logs", "-f", replica],
    ];
    for (const step of steps) {
      const status = runCompose(bin, baseArgs, step);
      if (status !== 0) {
        process.exit(status);
      }
    }
    process.exit(0);
    break;
  }
  case "open": {
    const status = openUrl("http://localhost:8080");
    if (status !== 0) {
      console.log("Open http://localhost:8080 in your browser.");
    }
    process.exit(0);
    break;
  }
  case "help":
  default:
    console.log([
      "Usage: node scripts/cluster.js <command> [args]",
      "",
      "Commands:",
      "  up [--build]               Start the cluster in detached mode",
      "  down                       Stop and remove cluster containers",
      "  logs [services...]         Tail compose logs (all services if omitted)",
      "  swap [replica]             Blue-green restart for one replica",
      "  open                       Open frontend URL in default browser",
    ].join("\n"));
    process.exit(0);
}
