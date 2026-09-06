import { spawn } from "node:child_process";
import { open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";

const lockPath = resolve(process.cwd(), ".dev-server.lock");
const owner = { pid: process.pid, startedAt: new Date().toISOString() };

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function acquireLock() {
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(owner)}\n`);
    await handle.close();
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  let existing = null;
  try {
    existing = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    // A corrupt or interrupted lock is stale and can be replaced.
  }

  if (processIsAlive(existing?.pid)) {
    console.error(
      `Development stack is already running (PID ${existing.pid}). ` +
        "Use that instance or stop it with Ctrl+C before starting another."
    );
    process.exit(1);
  }

  await unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  await acquireLock();
}

async function releaseLock() {
  try {
    const existing = JSON.parse(await readFile(lockPath, "utf8"));
    if (existing?.pid === process.pid) await unlink(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
}

await acquireLock();

const child = spawn("turbo", ["run", "dev"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  });
}

child.on("error", async (error) => {
  console.error(`Could not start development stack: ${error.message}`);
  await releaseLock();
  process.exit(1);
});

child.on("exit", async (code, signal) => {
  await releaseLock();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
