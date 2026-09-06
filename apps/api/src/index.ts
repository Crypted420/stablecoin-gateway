import { closeDb, connectionHint, migrate } from "@gateway/db";
import { assertChainDetectionConfigured, config, createLogger } from "@gateway/core";
import { createApp } from "./app.js";

const log = createLogger("api");

async function main(): Promise<void> {
  assertChainDetectionConfigured();
  await migrate();
  const port = config().API_PORT;
  const server = createApp().listen(port, () => log.debug("api listening", { port }));

  const shutdown = async () => {
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  log.error("api failed to start", { error: String(error) });
  const hint = connectionHint(error);
  if (hint) log.error(hint);
  process.exit(1);
});
