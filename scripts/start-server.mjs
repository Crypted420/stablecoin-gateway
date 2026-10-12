import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const secretFile = "/etc/secrets/gateway.env";
if (existsSync(secretFile)) process.loadEnvFile(secretFile);

// Host the API and worker together. Keep worker control on loopback and bind
// only the public API to the platform's assigned port.
const env = {
  ...process.env,
  API_PORT: process.env.PORT ?? "4000",
  WORKER_CONTROL_HOST: "127.0.0.1",
  WORKER_CONTROL_PORT: "4100",
  WORKER_CONTROL_URL: "http://127.0.0.1:4100"
};
const children = new Set();
let stopping = false;
let shutdownTimer;

function shutdown(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
  if (children.size === 0) return;
  shutdownTimer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 20_000);
}

for (const app of ["worker", "api"]) {
  const child = spawn(process.execPath, [`apps/${app}/dist/index.js`], { env, stdio: "inherit" });
  children.add(child);
  child.on("error", (error) => {
    console.error(`Could not start ${app}: ${error.message}`);
    process.exitCode = 1;
    children.delete(child);
    shutdown();
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${app} exited unexpectedly (code ${code}, signal ${signal})`);
      process.exitCode = code || 1;
      shutdown();
    }
    if (children.size === 0) clearTimeout(shutdownTimer);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
